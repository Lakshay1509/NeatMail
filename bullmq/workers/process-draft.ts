import { Job } from "bullmq";
import { useGetUserDraftPreference, incrementDraftCount } from "@/lib/supabase";
import { createGmailDraft, getGmailMessageBody } from "@/lib/gmail";
import { buildContextAndDraft } from "@/context-engine/pipeline";
import { IncomingEmail } from "@/context-engine/types";
import { clerkClient } from "@clerk/nextjs/server";
import { getDraftContext } from "@/lib/draft";
import { createOutlookDraft, getOutlookMessageBody } from "@/lib/outlook";
import { sendDraftNotification } from "@/lib/telegram";
import { getUserTier, getTierLimits } from "@/lib/tier-guard";

interface ProcessDraftData {
  userName: string;
  userId: string;
  emailData: {
    userId: string;
    subject: string;
    from: string;
    bodySnippet: string;
    threadId: string;
    receivedAt: string;
  };
  senderName: string;
  senderEmail: string;
  messageId: string;
  tokenData: string;
  is_gmail: boolean;
}

export async function processDraft(job: Job<ProcessDraftData>) {
  const {
    userName,
    userId,
    emailData,
    senderName,
    senderEmail,
    messageId,
    tokenData,
    is_gmail,
  } = job.data;

  const tier = await getUserTier(userId);

  if (tier === "FREE") {
    return { status: "skipped", reason: "Free tier does not include AI drafts" };
  }

  const draftPreference = await useGetUserDraftPreference(userId);

  if (!draftPreference.enabled) {
    return { status: "skipped", reason: "Drafts disabled" };
  }

  if (tier === "PRO") {
    const limits = await getTierLimits(userId);
    if (limits.maxAiDraftsPerMonth !== Infinity) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const needsReset =
        !draftPreference.draftCountResetAt ||
        new Date(draftPreference.draftCountResetAt) < startOfMonth;
      const currentCount = needsReset ? 0 : draftPreference.draftCount;

      if (currentCount >= limits.maxAiDraftsPerMonth) {
        return {
          status: "skipped",
          reason: `AI draft limit reached (${limits.maxAiDraftsPerMonth}/month) for ${tier} tier`,
        };
      }
    }
  }

  const { draftPrompt, fontColor, fontSize, signature, language } =
    draftPreference;

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const clerkUserFullName = user.fullName;

  let fullEmailBody = "";

  if (is_gmail) {
    try {
      fullEmailBody = await getGmailMessageBody(userId, messageId);
    } catch (error) {
      console.error(
        "Failed to fetch full Gmail body, using snippet fallback",
        { userId, messageId, error },
      );
      fullEmailBody = emailData.bodySnippet;
    }
  } else {
    try {
      fullEmailBody = await getOutlookMessageBody(userId, messageId);
    } catch (error) {
      console.error(
        "Failed to fetch full Outlook body, using snippet fallback",
        { userId, messageId, error },
      );
      fullEmailBody = emailData.bodySnippet;
    }
  }

  const incomingEmail: IncomingEmail = {
    userId: userId,
    subject: emailData.subject,
    body: fullEmailBody,
    senderName,
    senderEmail,
    receivedAt: new Date(emailData.receivedAt || Date.now()),
  };

  const response = await getDraftContext({
    user_name: userName,
    user_id: userId,
    subject: emailData.subject,
    sender_email: senderEmail,
    body: fullEmailBody,
    token: tokenData,
    timezone: draftPreference.timezone ?? "UTC",
    is_gmail: is_gmail,
    threadId: emailData.threadId,
  });

  const { draft } = await buildContextAndDraft(
    incomingEmail,
    is_gmail,
    draftPreference.timezone ?? "UTC",
    draftPrompt,
    clerkUserFullName,
    response.retrieved_history,
    response.thread_context,
    response.intent,
    response.keywords,
    response.mentionedDates,
    language,
  );

  let draft_id = "";
  let drafted = false;

  if (draft.trim() !== "NO_REPLY_NEEDED" && draft.trim().length > 0) {
    if (is_gmail) {
      const createdGmailDraft = await createGmailDraft(
        userId,
        emailData.threadId,
        messageId,
        emailData.subject,
        emailData.from,
        draft,
        fontColor,
        fontSize,
        signature,
      );
      draft_id = createdGmailDraft?.id ?? "";
      drafted = true;
    } else {
      const createdOutlookDraft = await createOutlookDraft(
        userId,
        messageId,
        emailData.subject,
        emailData.from,
        draft,
        fontColor,
        fontSize,
        signature,
      );
      draft_id = createdOutlookDraft?.id ?? "";
      drafted = true;
    }
  }

  if (draft.trim() !== "NO_REPLY_NEEDED" && draft.trim().length > 0) {
    if (is_gmail) {
      await sendDraftNotification(
        userId,
        emailData.from,
        emailData.subject,
        draft,
        draft_id,
      );
    }
  }

  if (drafted) {
    await incrementDraftCount(userId);
  }

  return { status: "success", drafted, draft_id };
}

export default processDraft;
