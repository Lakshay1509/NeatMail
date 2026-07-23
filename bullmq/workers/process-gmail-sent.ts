import { DelayedError, Job } from "bullmq";
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
  useGetUserDraftPreference,
} from "@/lib/supabase";
import { checkSentRequiresFollowUp } from "@/lib/sent-followup";
import {
  isOutboundPromiseCandidate,
  extractOutboundPromise,
  NUDGE_LEAD_MS,
} from "@/lib/promise";
import { encrypt, encryptDomain } from "@/lib/encode";
import { getUserTier } from "@/lib/tier-guard";
import { followUpQueue, promiseNudgeQueue } from "@/lib/queue";
import { gmailUserBurstLimiter } from "@/lib/rate-limit";

interface ProcessGmailSentData {
  clerkUserId: string;
  emailAddress: string;
  messageId: string;
}

export async function processGmailSent(
  job: Job<ProcessGmailSentData>,
  token?: string,
) {
  const { clerkUserId, messageId } = job.data;

  if (await isMessageProcessed(messageId)) {
    return { skipped: true, reason: "duplicate" };
  }

  // Shares a budget with process-gmail-mail so one user's total load (inbox +
  // sent) can't monopolize the worker capacity every other user relies on.
  const burst = await gmailUserBurstLimiter.limit(clerkUserId);
  if (!burst.success && token) {
    await job.moveToDelayed(Date.now() + 5000, token);
    throw new DelayedError();
  }

  await markMessageProcessed(messageId);

  try {
    // Defense-in-depth: skip lapsed/free accounts before doing any Gmail or
    // model work, mirroring process-gmail-mail. checkFollowUpLimit below already
    // rejects FREE (limit 0), but bailing here avoids the wasted API + model calls.
    const tier = await getUserTier(clerkUserId);
    if (tier === "FREE") {
      return { skipped: true, reason: "not subscribed" };
    }

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

    // --- Outbound promise tracking ("I owe them") ---
    // Independent of the follow-up feature: gated only on track_promises.
    // Fulfillment runs first (excluding the current message) so a promise can't
    // fulfill itself, then a fresh promise is extracted from this sent mail.
    // Wrapped so it can never break sent processing.
    if (threadId) {
      try {
        // Any earlier open outbound promise on this thread is delivered the moment
        // the user sends again in it — flip to FULFILLED and cancel its nudge job.
        const openOutbound = await db.tracked_promise.findMany({
          where: {
            user_id: clerkUserId,
            thread_id: threadId,
            direction: "OUTBOUND",
            status: { in: ["PENDING", "NUDGED"] },
            message_id: { not: messageId },
          },
          select: { id: true },
        });
        if (openOutbound.length) {
          await db.tracked_promise.updateMany({
            where: { id: { in: openOutbound.map((o) => o.id) } },
            data: { status: "FULFILLED", fulfilled_at: new Date() },
          });
          for (const o of openOutbound) {
            await promiseNudgeQueue.remove(`promise-nudge-${o.id}`);
          }
          console.log(
            `[promise] Fulfilled ${openOutbound.length} outbound promise(s) on thread ${threadId} — user sent again (gmail)`,
          );
        }

        const followUpPref = await db.follow_up_preference.findUnique({
          where: { user_id: clerkUserId },
          select: { track_promises: true },
        });
        if (
          followUpPref?.track_promises &&
          isOutboundPromiseCandidate({ subject, body: body ?? "" })
        ) {
          const toEmail = to.includes("<")
            ? (to.match(/<([^>]+)>/)?.[1] ?? to).trim()
            : to.trim();
          const draftPref = await useGetUserDraftPreference(clerkUserId);
          const sentDate = email.data.internalDate
            ? new Date(Number(email.data.internalDate))
            : new Date();
          const promise = await extractOutboundPromise({
            subject,
            body: body ?? "",
            toEmail,
            sentDate,
            userTimezone: draftPref.timezone ?? "UTC",
          });
          if (promise) {
            const domain = toEmail.split("@")[1] || null;
            // from_email holds the counterparty (here, the recipient we owe);
            // item + from_email are body-derived PII, encrypted at rest.
            const row = await db.tracked_promise.upsert({
              where: {
                user_id_message_id: {
                  user_id: clerkUserId,
                  message_id: messageId,
                },
              },
              update: {},
              create: {
                user_id: clerkUserId,
                thread_id: threadId,
                message_id: messageId,
                from_email: await encrypt(toEmail),
                from_domain: domain ? await encryptDomain(domain) : null,
                item: await encrypt(promise.item),
                due_at: promise.dueAt,
                confidence: promise.confidence,
                direction: "OUTBOUND",
              },
              select: { id: true },
            });
            const delay = Math.max(
              0,
              promise.dueAt.getTime() - NUDGE_LEAD_MS - Date.now(),
            );
            await promiseNudgeQueue.add(
              "nudge",
              { promiseId: row.id },
              { delay, jobId: `promise-nudge-${row.id}` },
            );
            console.log(
              `[promise] Tracked outbound promise on thread ${threadId}, nudge in ~${Math.round(delay / 60000)}m (due ${promise.dueAt.toISOString()})`,
            );
          }
        }
      } catch (err: any) {
        console.error(
          `[promise] outbound extraction failed (gmail): ${err?.message ?? err}`,
        );
      }
    }

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
        jobId: `follow-up-gmail-${threadId}`,
      },
    );

    return { success: true, sent: true, needsFollowUp };
  } catch (error) {
    await unmarkMessageProcessed(messageId);
    throw error;
  }
}

export default processGmailSent;
