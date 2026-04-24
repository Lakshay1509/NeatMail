import { inngest } from "@/lib/inngest";
import { getGmailMessageBody } from "@/lib/gmail";
import {
  isMessageProcessed,
  // isThreadProcessed,
  markMessageProcessed,
  // markThreadProcessed,
  unmarkMessageProcessed,
  // unmarkThreadProcessed,
} from "@/lib/redis";
import {
  addMailtoDB,
  getLastHistoryId,
  getTagsUser,
  getUserByEmail,
  getUserSubscribed,
  labelColor,
  updateHistoryId,
  updateMessageStatus,
  useGetUserDraftPreference,
} from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";
import { OAuth2Client } from "google-auth-library";
import { getModelResponse } from "@/lib/model";
import { handleLabelCorrections } from "@/lib/gmail-correction";
import { checkAndForwardToTelegram } from "@/lib/telegram";

export function parseFromHeader(fromHeader: string): {
  senderName: string;
  senderEmail: string;
} {
  const emailMatch = fromHeader.match(/<([^>]+)>/);
  const senderEmail = (emailMatch?.[1] || fromHeader).trim();
  const senderName = fromHeader
    .replace(/<[^>]+>/, "")
    .replace(/"/g, "")
    .trim();

  return {
    senderName: senderName || senderEmail,
    senderEmail,
  };
}

const authClient = new OAuth2Client();

const app = new Hono().post("/", async (ctx) => {
  let currentMessageId: string | null = null;
  let errorUserId: string | null = null;
  let errorEmail: string | null = null;
  // let currentThreadId: string | null = null;

  try {
    const authHeader = ctx.req.header("Authorization");

    if (!authHeader) {
      return ctx.json({ error: "Error missing authorization header" }, 401);
    }

    const token = authHeader.split(" ")[1];

    const ticket = await authClient.verifyIdToken({
      idToken: token,
      audience: "https://dashboard.neatmail.app/api/gmail-webhook",
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

    const user = await getUserByEmail(emailAddress);

    if (!user) {
      console.log("No user found");
      return ctx.json({ success: true }, 200);
    }

    const subscribed = await getUserSubscribed(user.clerk_user_id);

    if (subscribed.subscribed === false) {
      return ctx.json({ error: "user not subscribed" }, 200);
    }

    const clerkUserId = user.clerk_user_id;
    errorUserId = clerkUserId;

    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google",
    );

    const tokenData = tokenResponse.data[0]?.token;

    if (!tokenData) {
      console.log("No token found for user");
      return ctx.json({ success: true }, 200);
    }

    const lastHistoryId = await getLastHistoryId(emailAddress);

    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      await updateHistoryId(emailAddress, newHistoryId, true);
      return ctx.json({ success: true }, 200);
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: tokenData });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    let history;
    try {
      history = await gmail.users.history.list({
        userId: "me",
        startHistoryId: lastHistoryId.last_history_id,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      });
    } catch (err: any) {
      if (err.code === 410 || err.status === 410) {
        // historyId is too old/expired — reset it and ack the webhook
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

    const messages =
      history.data.history?.flatMap(
        (h) =>
          h.messagesAdded?.filter((m) =>
            m.message?.labelIds?.includes("INBOX"),
          ) || [],
      ) || [];

    for (const msg of messages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      if (await isMessageProcessed(messageId)) {
        continue;
      }

      // Mark as processed immediately to prevent race conditions
      await markMessageProcessed(messageId);
      currentMessageId = messageId;

      let email;
      try {
        email = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
        });
      } catch (err: any) {
        if (err.code === 404 || err.status === 404) {
          console.log(
            `Message ${messageId} not found (likely deleted), skipping.`,
          );
          currentMessageId = null;
          continue;
        }
        throw err;
      }

      const fullBody = await getGmailMessageBody(clerkUserId, messageId);
      const truncatedBody = fullBody?.slice(0, 300);

      const emailData = {
        userId: user.clerk_user_id,
        subject:
          email.data.payload?.headers?.find((h) => h.name === "Subject")
            ?.value || "",
        from:
          email.data.payload?.headers?.find((h) => h.name === "From")?.value ||
          "",
        bodySnippet: truncatedBody,
        threadId: email.data.threadId || "",
      };

      // currentThreadId = String(emailData.threadId);

      // if thread as processed for 24 hours to prevent duplication tags
      // if (await isThreadProcessed(String(emailData.threadId))) {
      //   currentMessageId = null;
      //   currentThreadId = null;
      //   continue;
      // }

      const tagsOfUser = await getTagsUser(clerkUserId);
      const draftsenstivity = (await useGetUserDraftPreference(clerkUserId))
        .senstivity;

      // Check if Gmail already classified this as Promotions
      let labelName: string;
      let responseRequired = false;
      const hasMarketingTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Marketing",
      );
      const hasReadonlyTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Read only",
      );

      const hasAutomatedAlertTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Automated alerts",
      );

      if (
        email.data.labelIds?.includes("CATEGORY_PROMOTIONS") &&
        hasMarketingTag
      ) {
        labelName = "Marketing";
      } else if (
        hasReadonlyTag &&
        email.data.labelIds?.includes("CATEGORY_SOCIAL")
      ) {
        labelName = "Read only";
      } else if (
        (email.data.labelIds?.includes("CATEGORY_PROMOTIONS") ||
          email.data.labelIds?.includes("CATEGORY_SOCIAL")) &&
        hasAutomatedAlertTag
      ) {
        labelName = "Automated alerts";
      } else {
        const classification = await getModelResponse({
          bodySnippet: emailData.bodySnippet,
          from: emailData.from,
          subject: emailData.subject,
          user_id: emailData.userId,
          tags: tagsOfUser.map((t) => ({
            name: t.tag.name,
            description: t.tag.description ?? "",
          })),
          sensitivity: draftsenstivity || "if actionable",
        });
        labelName = classification.category;

        responseRequired = classification.response_required === true;
      }

      const shouldDraft =
        (labelName === "Pending Response" || labelName === "Action Needed") &&
        responseRequired;

      if (labelName === "" && !shouldDraft) {
        await addMailtoDB(clerkUserId, null, String(messageId), emailData.from);
        console.log(`No label assigned for message: ${messageId}`);
        continue;
      }

      if (labelName.trim().length > 0) {
        const colourofLabel = await labelColor(labelName, clerkUserId);

        const labelsResponse = await gmail.users.labels.list({ userId: "me" });
        let labelId = labelsResponse.data.labels?.find(
          (l) => l.name === labelName,
        )?.id;

        if (!labelId) {
          console.log(`Creating new label: ${labelName}`);
          const newLabel = await gmail.users.labels.create({
            userId: "me",
            requestBody: {
              name: labelName,
              labelListVisibility: "labelShow",
              messageListVisibility: "show",
              color: {
                textColor: "#ffffff",
                backgroundColor: colourofLabel.color,
              },
            },
          });
          labelId = newLabel.data.id!;
        }

        // Apply label
        try {
          await gmail.users.messages.modify({
            userId: "me",
            id: messageId,
            requestBody: {
              addLabelIds: [labelId],
            },
          });
        } catch (err: any) {
          if (err.code === 404 || err.status === 404) {
            console.log(
              `Message ${messageId} deleted before label could be applied, skipping.`,
            );
            currentMessageId = null;
            // currentThreadId = null;
            continue;
          }
          throw err;
        }

        const { senderEmail } = parseFromHeader(emailData.from);
        await checkAndForwardToTelegram(
          clerkUserId,
          senderEmail,
          emailData.subject,
          fullBody,
          colourofLabel.id,
          colourofLabel.name,
        );

        await addMailtoDB(
          clerkUserId,
          colourofLabel.id,
          String(messageId),
          emailData.from,
        );
      }

      if (shouldDraft) {
        const { senderName, senderEmail } = parseFromHeader(emailData.from);
        await inngest.send({
          name: "email/process.draft",
          data: {
            userId: clerkUserId,
            emailData: {
              ...emailData,
              receivedAt: new Date().toISOString(),
            },
            senderName: senderName,
            senderEmail: senderEmail,
            messageId: messageId,
            tokenData: tokenData,
            is_gmail: true,
          },
        });
      }

      // await markThreadProcessed(String(emailData.threadId));

      currentMessageId = null;
      // currentThreadId = null;
    }

    await updateHistoryId(emailAddress, String(newHistoryId), true);

    return ctx.json({ success: true }, 200);
  } catch (error: any) {
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

    if (currentMessageId) {
      await unmarkMessageProcessed(currentMessageId);
    }
    // if (currentThreadId) {
    //   await unmarkThreadProcessed(currentThreadId);
    // }

    return ctx.json(
      { success: false, error: "Processing failed of webhook" },
      200,
    );
  }
});

export default app;
