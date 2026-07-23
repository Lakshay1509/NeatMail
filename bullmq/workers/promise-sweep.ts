import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { createGmailDraft, getGmailClient } from "@/lib/gmail";
import { getUserTier } from "@/lib/tier-guard";
import {
  getUserSubscribed,
  useGetUserDraftPreference,
  checkFollowUpLimit,
  incrementFollowUpCount,
} from "@/lib/supabase";
import { decrypt } from "@/lib/encode";
import { generatePromiseNudge } from "@/lib/promise";
import { formatInTimeZone } from "date-fns-tz";

// Cap per run so one sweep can't monopolize the worker; leftovers roll to the
// next scheduled run. Promises overdue by a couple hours is fine.
const SWEEP_BATCH = 200;

/**
 * Periodic sweep for overdue, still-open inbound promises. For each, resurfaces
 * the Gmail thread in place (Follow up + INBOX + UNREAD), drops a pre-written
 * nudge draft, and flips the promise to NUDGED. Fulfillment is event-driven in
 * process-gmail-mail.ts, so anything the sender already delivered was flipped
 * to FULFILLED and never appears here.
 */
export async function processPromiseSweep(_job: Job) {
  const now = new Date();

  const due = await db.tracked_promise.findMany({
    where: { status: "PENDING", due_at: { lte: now } },
    orderBy: { due_at: "asc" },
    take: SWEEP_BATCH,
    select: {
      id: true,
      user_id: true,
      thread_id: true,
      message_id: true,
      from_email: true,
      item: true,
      due_at: true,
    },
  });

  let nudged = 0;

  for (const p of due) {
    try {
      // Entitlement re-check: a promise row can outlive the subscription or the
      // opt-in that created it.
      const tier = await getUserTier(p.user_id);
      if (tier === "FREE") continue;

      const sub = await getUserSubscribed(p.user_id);
      if (!sub.subscribed) continue;

      const pref = await db.follow_up_preference.findUnique({
        where: { user_id: p.user_id },
        select: {
          track_promises: true,
          ai_drafts: true,
          user_tokens: { select: { deleted_flag: true } },
        },
      });
      if (pref?.user_tokens?.deleted_flag) continue;
      if (!pref?.track_promises) continue; // user turned promise tracking off

      // Meter against the shared monthly follow-up allowance. Over the cap we
      // just skip: the row stays PENDING and is retried after the monthly reset.
      const allowed = await checkFollowUpLimit(p.user_id);
      if (!allowed) continue;

      const to = await decrypt(p.from_email);
      const item = await decrypt(p.item);

      const gmail = await getGmailClient(p.user_id);

      // The promise message carries the subject we reply into. If it's gone
      // (deleted/expunged), the promise is moot, so drop it.
      let subject = "";
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: p.message_id,
          format: "metadata",
          metadataHeaders: ["Subject"],
        });
        subject =
          msg.data.payload?.headers?.find((h) => h.name === "Subject")?.value ||
          "";
      } catch (err: any) {
        if (err?.code === 404 || err?.status === 404) {
          await db.tracked_promise.update({
            where: { id: p.id },
            data: { status: "DISMISSED" },
          });
          continue;
        }
        throw err;
      }

      const draftPref = await useGetUserDraftPreference(p.user_id);
      const tz = draftPref.timezone ?? "UTC";
      const dueLabel = formatInTimeZone(p.due_at, tz, "MMMM d");

      // Resurface in place first: reuse the "Follow up" label and ensure the
      // thread is back in the inbox + unread so the nudge is actually seen.
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
            color: { textColor: "#ffffff", backgroundColor: "#4a86e8" },
          },
        });
        labelId = newLabel.data.id!;
      }

      await gmail.users.messages.modify({
        userId: "me",
        id: p.message_id,
        requestBody: { addLabelIds: [labelId, "INBOX", "UNREAD"] },
      });

      // Claim the promise BEFORE the non-idempotent draft. If drafting then
      // fails, the row is already NUDGED so the next sweep won't re-pick it and
      // re-draft (createGmailDraft has no dedup, so that would duplicate). Worst
      // case is a surfaced thread without a pre-written draft, never a double.
      await db.tracked_promise.update({
        where: { id: p.id },
        data: { status: "NUDGED", nudged_at: new Date() },
      });
      await incrementFollowUpCount(p.user_id);

      // Pre-written nudge draft, last (unless the user disabled AI drafts).
      if (pref.ai_drafts !== false) {
        const nudge = await generatePromiseNudge({ subject, item, to, dueLabel });
        if (nudge) {
          await createGmailDraft(
            p.user_id,
            p.thread_id,
            p.message_id,
            subject,
            to,
            nudge,
            draftPref.fontColor,
            draftPref.fontSize,
            draftPref.signature,
          );
        }
      }

      nudged++;
      console.log(
        `[promise-sweep] Nudged overdue promise ${p.id} on thread ${p.thread_id}`,
      );
    } catch (err: any) {
      // Leave the row PENDING so the next sweep retries it.
      console.error(
        `[promise-sweep] Failed promise ${p.id}: ${err?.message ?? err}`,
      );
    }
  }

  console.log(`[promise-sweep] Nudged ${nudged}/${due.length} due promise(s)`);
  return { status: "success", nudged, considered: due.length };
}

export default processPromiseSweep;
