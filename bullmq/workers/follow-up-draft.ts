import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import {
  createGmailDraft,
  getGmailClient,
  stripGmailStatusLabels,
} from "@/lib/gmail";
import {
  createOutlookDraft,
  getGraphClient,
  surfaceOutlookFollowUp,
} from "@/lib/outlook";
import {
  useGetUserDraftPreference,
  addMailtoDB,
  getUserSubscribed,
} from "@/lib/supabase";
import { getUserTier } from "@/lib/tier-guard";
import { isMemberAccessPaused } from "@/lib/organization";
import { generateFollowUpMessage } from "@/lib/sent-followup";
import { clerkClient } from "@clerk/nextjs/server";

interface FollowUpDraftData {
  userId: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  body: string;
  isGmail: boolean;
  aiDrafts?: boolean;
}

export async function processFollowUpDraft(job: Job<FollowUpDraftData>) {
  const { userId, messageId, threadId, subject, to, body, isGmail, aiDrafts } =
    job.data;

  // Defense-in-depth: this job was enqueued with a multi-day delay
  // (follow_up_preference.days), so the user's entitlement may have lapsed since
  // it was scheduled — cancelled, failed to renew, disabled follow-ups, or
  // deleted their account. Re-check at run time, mirroring the archive-backlog
  // and first-sweep workers.
  const tier = await getUserTier(userId);
  if (tier === "FREE") {
    return { status: "skipped", reason: "not subscribed" };
  }

  const sub = await getUserSubscribed(userId);
  if (!sub.subscribed) {
    return { status: "skipped", reason: "not subscribed" };
  }

  const followUpPref = await db.follow_up_preference.findUnique({
    where: { user_id: userId },
    select: {
      enabled: true,
      user_tokens: { select: { deleted_flag: true, is_folder: true } },
    },
  });
  if (followUpPref?.user_tokens?.deleted_flag) {
    return { status: "skipped", reason: "account deleted" };
  }
  if (!followUpPref?.enabled) {
    return { status: "skipped", reason: "follow-ups disabled" };
  }
  // Paused team members: same skip as the mail workers.
  if (await isMemberAccessPaused(userId)) {
    return { status: "skipped", reason: "member access paused" };
  }

  const prefs = await useGetUserDraftPreference(userId);

  if (isGmail) {
    const gmail = await getGmailClient(userId);
    // Never bring back mail the user deleted or that went to spam (adding INBOX
    // below would resurface it).
    try {
      const current = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "minimal",
      });
      const labelIds = current.data.labelIds ?? [];
      if (labelIds.includes("TRASH") || labelIds.includes("SPAM")) {
        return { status: "skipped", reason: "message trashed" };
      }
    } catch (err) {
      const e = err as { code?: number; status?: number };
      if (e?.code === 404 || e?.status === 404) {
        return { status: "skipped", reason: "message deleted" };
      }
      throw err;
    }

    if (aiDrafts !== false) {
      const followUpBody = await generateFollowUpMessage({ subject, body, to });
      if (followUpBody) {
        await createGmailDraft(
          userId,
          threadId,
          messageId,
          subject,
          to,
          followUpBody,
          prefs.fontColor,
          prefs.fontSize,
          prefs.signature,
        );
      }
    }

    const labelsResponse = await gmail.users.labels.list({ userId: "me" });
    let labelId = labelsResponse.data.labels?.find(
      (l) => l.name === "Follow up",
    )?.id;

    if (!labelId) {
      const newLabel = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: "Follow up",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
          color: {
            textColor: "#ffffff",
            backgroundColor: "#4a86e8",
          },
        },
      });
      labelId = newLabel.data.id!;
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        // INBOX brings it back even if the thread was archived (same rule as
        // Outlook: no reply, so it comes back for attention).
        addLabelIds: ["UNREAD", "INBOX"],
      },
    });

    // "Follow up" replaces the thread's NeatMail label (one label per thread).
    await stripGmailStatusLabels(
      gmail,
      threadId,
      labelsResponse.data.labels ?? [],
    );

    await addMailtoDB(userId, null, messageId, to, `send follow up to ${to}`, "follow up required");

    console.log(
      `[follow-up-draft] Applied "Follow up" label to ${messageId} (gmail)`,
    );

    return { status: "success" };
  }

  // --- Outlook path: Sent Items → back to the Inbox (folder mode: "Follow up"
  // folder, since there the label is the folder) → "Follow up" category → draft
  // → mark unread. Same rule as Gmail: no reply, so it comes back for attention.
  const graphClient = await getGraphClient(userId);
  let targetMessageId: string | null;
  try {
    targetMessageId = await surfaceOutlookFollowUp(graphClient, {
      userId,
      messageId,
      conversationId: threadId,
      isFolder: followUpPref.user_tokens?.is_folder === true,
    });
  } catch (err) {
    // Gone, or already moved under a new id (e.g. a promise nudge surfaced this
    // same sent mail first) — nothing to bring back, so don't burn retries.
    if ((err as { statusCode?: number })?.statusCode === 404) {
      return { status: "skipped", reason: "message moved or deleted" };
    }
    throw err;
  }
  if (!targetMessageId) {
    return { status: "skipped", reason: "message in Deleted Items / Junk" };
  }
  // The move minted a new id: a retry after a later failure must use it, not
  // the old Sent Items id (which would 404 on every attempt).
  await job.updateData({ ...job.data, messageId: targetMessageId });

  const clerk = await clerkClient();
  const externalAccounts = await clerk.users.getUserOauthAccessToken(
    userId,
    "microsoft",
  );
  const accessToken = externalAccounts.data[0]?.token;

  async function markUnread(messageId: string) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isRead: false }),
      },
    );
    if (!res.ok) {
      console.warn(
        `[follow-up-draft] markUnread failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  await markUnread(targetMessageId);

  if (aiDrafts !== false) {
    const followUpBody = await generateFollowUpMessage({ subject, body, to });
    if (followUpBody) {
      await createOutlookDraft(
        userId,
        targetMessageId,
        subject,
        to,
        followUpBody,
        prefs.fontColor,
        prefs.fontSize,
        prefs.signature,
      );
    }
  }

  await markUnread(targetMessageId);

  await addMailtoDB(userId, null, targetMessageId, to, `send follow up to ${to}`, "follow up required");

  console.log(
    `[follow-up-draft] Surfaced for follow-up (id=${targetMessageId}), tagged and marked unread (outlook)`,
  );

  return { status: "success" };
}

export default processFollowUpDraft;
