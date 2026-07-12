import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { getGmailClient, getGmailMessageBody } from "@/lib/gmail";
import {
  isMessageProcessed,
  markMessageProcessed,
  unmarkMessageProcessed,
} from "@/lib/redis";
import {
  checkFollowUpLimit,
  incrementFollowUpCount,
} from "@/lib/supabase";
import { checkSentRequiresFollowUp } from "@/lib/sent-followup";
import { followUpQueue } from "@/lib/queue";

interface ProcessGmailSentData {
  clerkUserId: string;
  emailAddress: string;
  messageId: string;
}

export async function processGmailSent(job: Job<ProcessGmailSentData>) {
  const { clerkUserId, messageId } = job.data;

  if (await isMessageProcessed(messageId)) {
    return { skipped: true, reason: "duplicate" };
  }

  await markMessageProcessed(messageId);

  try {
    const gmail = await getGmailClient(clerkUserId);

    let email;
    try {
      email = await gmail.users.messages.get({ userId: "me", id: messageId });
    } catch {
      return { skipped: true, reason: "message not found" };
    }

    const subject =
      email.data.payload?.headers?.find((h) => h.name === "Subject")
        ?.value || "";
    const body = await getGmailMessageBody(clerkUserId, messageId);
    const to =
      email.data.payload?.headers?.find((h) => h.name === "To")?.value || "";
    const threadId = email.data.threadId ?? "";

    const needsFollowUp = await checkSentRequiresFollowUp({
      subject,
      body,
      to,
    });

    console.log(
      `[sent-followup] ${messageId} → ${needsFollowUp ? "follow-up needed" : "no follow-up needed"}`,
    );

    if (!needsFollowUp) {
      return { success: true, sent: true, needsFollowUp };
    }

    const pref = await db.follow_up_preference.findUnique({
      where: { user_id: clerkUserId },
    });

    if (!pref?.enabled) {
      return { success: true, sent: true, needsFollowUp };
    }

    const toEmail = to.includes("<")
      ? (to.match(/<([^>]+)>/)?.[1] ?? to)
      : to;
    const skipList = (pref.skip_emails ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const shouldSkip = skipList.some((skip) =>
      toEmail.toLowerCase().includes(skip),
    );

    if (shouldSkip) {
      return { success: true, sent: true, needsFollowUp };
    }

    const withinLimit = await checkFollowUpLimit(clerkUserId);
    if (!withinLimit) {
      console.log(
        `[sent-followup] ${messageId} → skipped (monthly limit reached)`,
      );
      return { success: true, sent: true, needsFollowUp, skippedDueToLimit: true };
    }

    await incrementFollowUpCount(clerkUserId);
    await followUpQueue.remove(`follow-up:gmail:${threadId}`);
    await followUpQueue.add(
      "follow-up",
      {
        userId: clerkUserId,
        messageId,
        threadId,
        subject,
        to,
        body: body ?? "",
        isGmail: true,
        aiDrafts: pref.ai_drafts,
      },
      {
        delay: pref.days * 24 * 60 * 60 * 1000,
        jobId: `follow-up:gmail:${threadId}`,
      },
    );

    return { success: true, sent: true, needsFollowUp };
  } catch (error) {
    await unmarkMessageProcessed(messageId);
    throw error;
  }
}

export default processGmailSent;
