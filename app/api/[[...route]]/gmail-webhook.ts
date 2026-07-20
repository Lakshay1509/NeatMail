import { gmailMailQueue, gmailSentQueue } from "@/lib/queue";
import { getGmailClient, OAuthError, isOAuthRevokedError } from "@/lib/gmail";
import {
  claimReconnectReminder,
  releaseReconnectReminder,
} from "@/lib/redis";
import { sendReconnectEmail } from "@/lib/resend";
import {
  getLastHistoryId,
  getUserByEmail,
  updateHistoryId,
  updateMessageStatus,
} from "@/lib/supabase";
import { getUserTier } from "@/lib/tier-guard";
import { isMemberAccessPaused } from "@/lib/organization";
import { clerkClient } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { OAuth2Client } from "google-auth-library";
import { handleLabelCorrections } from "@/lib/gmail-correction";

const authClient = new OAuth2Client();

const app = new Hono().post("/", async (ctx) => {
  let errorUserId: string | null = null;
  let errorEmail: string | null = null;

  try {
    const authHeader = ctx.req.header("Authorization");

    if (!authHeader) {
      return ctx.json({ error: "Error missing authorization header" }, 401);
    }

    const token = authHeader.split(" ")[1];

    const ticket = await authClient.verifyIdToken({
      idToken: token,
      audience: `${process.env.NEXT_PUBLIC_API_URL}/api/gmail-webhook`,
    });

    const payload = ticket.getPayload();

    if (payload?.email !== process.env.GMAIL_SERVICE_ACCOUNT) {
      return ctx.json({ error: "Invalid service account" }, 401);
    }

    const body = await ctx.req.json();
    const message = body.message;

    if (!message?.data) {
      return ctx.json({ success: true }, 200);
    }

    const decodedData = Buffer.from(message.data, "base64").toString();

    const notification = JSON.parse(decodedData);

    const { emailAddress, historyId: newHistoryId } = notification;
    errorEmail = emailAddress;

    if (emailAddress === process.env.GOOGLE_VERIFICATION_EMAIL) {
      return ctx.json({ success: true }, 200);
    }

    const user = await getUserByEmail(emailAddress);

    if (!user) {
      console.log("No user found");
      return ctx.json({ success: true }, 200);
    }

    // Skip users scheduled for deletion. Watch is deactivated at delete-request time,
    // but this catches a lingering watch that hasn't expired yet. Ack so Gmail doesn't retry.
    if (user.deleted_flag) {
      console.log(`[webhook] ${emailAddress} scheduled for deletion — skipping`);
      return ctx.json({ success: true }, 200);
    }

    const tier = await getUserTier(user.clerk_user_id);
    if (tier === "FREE") {
      return ctx.json({ error: "user not subscribed" }, 200);
    }

    // A paused member keeps their inherited MAX tier, so the tier gate above passes.
    // Watch is stopped when paused, but skip here too in case a push is in-flight or re-armed.
    if (await isMemberAccessPaused(user.clerk_user_id)) {
      console.log(`[webhook] ${emailAddress} is a paused team member — skipping`);
      return ctx.json({ success: true }, 200);
    }

    const clerkUserId = user.clerk_user_id;
    errorUserId = clerkUserId;

    const client = await clerkClient();
    const userDataFromClerk = await client.users.getUser(user.clerk_user_id);
    const fullName = `${userDataFromClerk.fullName ?? ""}`.trim();

    let tokenData: string | undefined;
    try {
      const tokenResponse = await client.users.getUserOauthAccessToken(
        clerkUserId,
        "google",
      );
      tokenData = tokenResponse.data[0]?.token;
    } catch (err: any) {
      // Only a genuine revoke/permission removal means the user must reconnect.
      // Transient Clerk failures (429 rate limit, 5xx, network) leave the token
      // intact — rethrow so we log/ack instead of falsely emailing "reconnect".
      if (!isOAuthRevokedError(err)) throw err;
      console.log(`[webhook] OAuth token unavailable for ${emailAddress} — acking`);
    }

    if (!tokenData) {
      console.log(`[webhook] No token for ${clerkUserId} — acking`);
      // Token revoked: nudge to reconnect, throttled to once per 3 days so the webhook flood doesn't spam.
      if (await claimReconnectReminder(clerkUserId)) {
        try {
          await sendReconnectEmail(emailAddress, fullName);
          console.log(`[webhook] Sent reconnect reminder to ${emailAddress}`);
        } catch (e) {
          // Release the claim so a later webhook can retry the send.
          await releaseReconnectReminder(clerkUserId);
          console.error(
            `[webhook] Failed to send reconnect reminder to ${emailAddress}`,
            e,
          );
        }
      }
      return ctx.json({ success: true }, 200);
    }

    const lastHistoryId = await getLastHistoryId(emailAddress);

    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      await updateHistoryId(emailAddress, String(newHistoryId), true);
      return ctx.json({ success: true }, 200);
    }

    let gmail;
    try {
      gmail = await getGmailClient(clerkUserId);
    } catch (err: any) {
      if (err instanceof OAuthError) {
        console.log(`[webhook] Gmail client OAuth error for ${emailAddress}`);
        await updateHistoryId(emailAddress, String(newHistoryId), true);
        return ctx.json({ success: true }, 200);
      }
      throw err;
    }

    let history;
    try {
      history = await gmail.users.history.list({
        userId: "me",
        startHistoryId: lastHistoryId.last_history_id,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      });
    } catch (err: any) {
      if (err.code === 410 || err.status === 410) {
        // historyId is too old/expired, reset it and ack the webhook
        console.log(
          `historyId ${lastHistoryId.last_history_id} expired for ${emailAddress}, resetting.`,
        );
        await updateHistoryId(emailAddress, String(newHistoryId), true);
        return ctx.json({ success: true }, 200);
      }
      throw err;
    }

    const historyRecords = history.data.history ?? [];

    // Trigger label modifications endpoint asynchronously
    handleLabelCorrections(gmail, clerkUserId, historyRecords).catch((e) =>
      console.error("Error running label correction handler:", e),
    );

    for (const record of historyRecords) {
      for (const item of record.labelsRemoved ?? []) {
        if (item.labelIds?.includes("UNREAD")) {
          const messageId = item.message?.id;
          if (!messageId) continue;
          await updateMessageStatus(messageId, true);
        }
      }

      for (const item of record.labelsAdded ?? []) {
        if (item.labelIds?.includes("UNREAD")) {
          const messageId = item.message?.id;
          if (!messageId) continue;
          await updateMessageStatus(messageId, false);
        }
      }
    }

    // Incoming mail only. A self-sent message carries both INBOX and SENT, so
    // guard against SENT here too — otherwise the user's own mail leaks into the
    // incoming pipeline and gets tracked/classified. Genuine sent mail (SENT and
    // not INBOX) is handled separately below for follow-ups.
    const messages =
      history.data.history?.flatMap(
        (h) =>
          h.messagesAdded?.filter(
            (m) =>
              m.message?.labelIds?.includes("INBOX") &&
              !m.message?.labelIds?.includes("SENT"),
          ) || [],
      ) || [];

    const sentMessages =
      history.data.history?.flatMap(
        (h) =>
          h.messagesAdded?.filter((m) =>
            m.message?.labelIds?.includes("SENT") &&
            !m.message?.labelIds?.includes("INBOX"),
          ) || [],
      ) || [];

    // Queued instead of processed inline: a downtime catch-up burst would block this webhook
    // behind dozens of sequential Gmail calls. Workers rate-limit to stay under Gmail's per-user quota.
    for (const msg of messages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      await gmailMailQueue.add(
        "process-mail",
        { clerkUserId, emailAddress, messageId },
        { jobId: `gmail/msg/${messageId}` },
      );
    }

    for (const msg of sentMessages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      await gmailSentQueue.add(
        "process-sent",
        { clerkUserId, emailAddress, messageId },
        { jobId: `gmail/sent/${messageId}` },
      );
    }

    await updateHistoryId(emailAddress, String(newHistoryId), true);

    return ctx.json({ success: true }, 200);
  } catch (error: any) {
    const isAuthError =
      error instanceof OAuthError ||
      (error.code === "api_response_error" && error.status === 400);

    if (isAuthError) {
      console.log(`[webhook] OAuth error for ${errorUserId} (${errorEmail})`);
    } else {
      console.error(
        `❌ Error processing webhook for user: ${errorUserId} (${errorEmail})`,
      );
      console.error("❌ Error Message:", error.message || String(error));

      if (error.clerkError) {
        console.error(
          "❌ Clerk API Error details:",
          JSON.stringify(
            {
              status: error.status,
              code: error.code,
              clerkTraceId: error.clerkTraceId,
              errors: error.errors,
            },
            null,
            2,
          ),
        );
      } else if (error.errors) {
        console.error(
          "❌ Detailed errors payload:",
          JSON.stringify(error.errors, null, 2),
        );
      } else if (error.stack) {
        console.error("❌ Stack trace:", error.stack);
      } else {
        console.error("❌ Error Object:", error);
      }
    }

    return ctx.json(
      { success: false, error: "Processing failed of webhook" },
      200,
    );
  }
});

export default app;
