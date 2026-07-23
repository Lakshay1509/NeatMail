import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { createGmailDraft, getGmailClient } from "@/lib/gmail";
import { createOutlookDraft, getGraphClient } from "@/lib/outlook";
import { markMessageProcessed } from "@/lib/redis";
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
 * the thread and drops a pre-written nudge draft, then flips it to NUDGED:
 *   - Gmail  → tag in place: "Follow up" label + INBOX + UNREAD.
 *   - Outlook → move the mail into the "Follow up" folder + mark unread.
 * Fulfillment (per-arrival, in the mail workers) is event-driven, so anything
 * the sender already delivered was flipped to FULFILLED and never appears here.
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
      user_tokens: { select: { is_gmail: true } },
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
      const draftPref = await useGetUserDraftPreference(p.user_id);
      const tz = draftPref.timezone ?? "UTC";
      const dueLabel = formatInTimeZone(p.due_at, tz, "MMMM d");

      // ---- Outlook: move the promise mail into the "Follow up" folder ----
      if (p.user_tokens?.is_gmail === false) {
        const graphClient = await getGraphClient(p.user_id);

        let subject = "";
        try {
          const msg = await graphClient
            .api(`/me/messages/${p.message_id}`)
            .select("subject")
            .get();
          subject = msg.subject ?? "";
        } catch (err: any) {
          if (err?.statusCode === 404) {
            await db.tracked_promise.update({
              where: { id: p.id },
              data: { status: "DISMISSED" },
            });
            continue;
          }
          throw err;
        }

        // Find or create the "Follow up" folder.
        const foldersResponse = await graphClient
          .api("/me/mailFolders")
          .filter("displayName eq 'Follow up'")
          .get();
        let folderId: string;
        if (foldersResponse.value && foldersResponse.value.length > 0) {
          folderId = foldersResponse.value[0].id;
        } else {
          const newFolder = await graphClient
            .api("/me/mailFolders")
            .post({ displayName: "Follow up" });
          folderId = newFolder.id;
        }

        // Move it there and mark unread. The move mints a NEW message id; mark
        // it processed so the move's own "created" notification (when the
        // Follow up folder is watched) can't be misread as the promiser
        // delivering — same guard the follow-up move-back uses.
        const moved = await graphClient
          .api(`/me/messages/${p.message_id}/move`)
          .post({ destinationId: folderId });
        const newId = moved.id as string;
        await markMessageProcessed(newId);
        await graphClient.api(`/me/messages/${newId}`).patch({ isRead: false });

        // Claim BEFORE the non-idempotent draft, and repoint the row at the
        // moved id (the old id no longer exists after a move).
        await db.tracked_promise.update({
          where: { id: p.id },
          data: { status: "NUDGED", nudged_at: new Date(), message_id: newId },
        });
        await incrementFollowUpCount(p.user_id);

        if (pref.ai_drafts !== false) {
          const nudge = await generatePromiseNudge({ subject, item, to, dueLabel });
          if (nudge) {
            await createOutlookDraft(
              p.user_id,
              newId,
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
          `[promise-sweep] Nudged overdue promise ${p.id} on conversation ${p.thread_id} (outlook)`,
        );
        continue;
      }

      // ---- Gmail: tag in place ("Follow up" + INBOX + UNREAD) ----
      const gmail = await getGmailClient(p.user_id);

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

      // Claim BEFORE the non-idempotent draft so a failure can't re-draft.
      await db.tracked_promise.update({
        where: { id: p.id },
        data: { status: "NUDGED", nudged_at: new Date() },
      });
      await incrementFollowUpCount(p.user_id);

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
        `[promise-sweep] Nudged overdue promise ${p.id} on thread ${p.thread_id} (gmail)`,
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
