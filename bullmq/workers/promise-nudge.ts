import { Job } from "bullmq";
import { clerkClient } from "@clerk/nextjs/server";
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
import { generateOutboundPromiseDraft } from "@/lib/promise";
import { sendPromiseDueEmail } from "@/lib/resend";
import { formatInTimeZone } from "date-fns-tz";

interface PromiseNudgeData {
  promiseId: string;
}

// Human deadline label. Inbound stores date-only promises as 23:59:59 in the
// user's tz; treat that sentinel as "no time given" so we don't show "11:59 PM".
function formatDueLabel(due: Date, tz: string): string {
  const hms = formatInTimeZone(due, tz, "HH:mm:ss");
  return hms === "23:59:59"
    ? formatInTimeZone(due, tz, "MMMM d")
    : formatInTimeZone(due, tz, "MMMM d 'at' h:mm a");
}

/**
 * Fires ~30 min before an OUTBOUND promise ("I owe them") comes due, when the
 * user still hasn't sent the thing (fulfillment in the sent-mail workers flips
 * delivered promises to FULFILLED and removes this job, so anything still PENDING
 * genuinely needs a nudge). Surfaces the thread under "Follow up", emails the user
 * a reminder, and — best-effort, metered — drops a ready-to-send delivery draft.
 *   - Gmail  → tag the sent message in place: "Follow up" + INBOX + UNREAD.
 *   - Outlook → move the sent message into the "Follow up" folder + mark unread.
 */
export async function processPromiseNudge(job: Job<PromiseNudgeData>) {
  const { promiseId } = job.data;

  const p = await db.tracked_promise.findUnique({
    where: { id: promiseId },
    select: {
      id: true,
      user_id: true,
      thread_id: true,
      message_id: true,
      from_email: true,
      item: true,
      due_at: true,
      status: true,
      direction: true,
      user_tokens: {
        select: { is_gmail: true, deleted_flag: true, email: true },
      },
    },
  });

  // Only an untouched, still-open outbound promise gets nudged. Fulfilled,
  // dismissed, or already-nudged rows (and the wrong direction) are no-ops — this
  // is also the idempotency guard if the delayed job somehow fires twice.
  if (!p) return { status: "skipped", reason: "promise gone" };
  if (p.direction !== "OUTBOUND") return { status: "skipped", reason: "not outbound" };
  if (p.status !== "PENDING") return { status: "skipped", reason: `status ${p.status}` };
  if (p.user_tokens?.deleted_flag) return { status: "skipped", reason: "account deleted" };

  // Entitlement re-check: this job was scheduled with a long delay, so the plan,
  // subscription, or opt-in may have lapsed since. Mirrors the promise sweep.
  const tier = await getUserTier(p.user_id);
  if (tier === "FREE") return { status: "skipped", reason: "not subscribed" };

  const sub = await getUserSubscribed(p.user_id);
  if (!sub.subscribed) return { status: "skipped", reason: "not subscribed" };

  const pref = await db.follow_up_preference.findUnique({
    where: { user_id: p.user_id },
    select: { track_promises: true, ai_drafts: true },
  });
  if (!pref?.track_promises) return { status: "skipped", reason: "tracking off" };

  // One nudge = one unit of the shared monthly follow-up allowance, gated as a
  // whole — same as the inbound sweep and regular follow-ups. Over the cap the
  // nudge is skipped entirely (no surface, no email, no draft); being a one-shot
  // job it won't fire again this cycle, and the row stays PENDING.
  if (!(await checkFollowUpLimit(p.user_id))) {
    return { status: "skipped", reason: "follow-up limit reached" };
  }

  const to = await decrypt(p.from_email); // outbound: from_email holds the recipient
  const item = await decrypt(p.item);
  const draftPref = await useGetUserDraftPreference(p.user_id);
  const tz = draftPref.timezone ?? "UTC";
  const dueLabel = formatDueLabel(p.due_at, tz);

  const isGmail = p.user_tokens?.is_gmail !== false;

  // ---- 1. Surface the sent message under "Follow up" ----
  let subject = "";
  let draftMessageId = p.message_id;

  if (isGmail) {
    const gmail = await getGmailClient(p.user_id);

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
        return { status: "skipped", reason: "message deleted" };
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

    // Claim NUDGED before the non-idempotent draft/email so a retry can't
    // re-surface or double-draft; the status guard above then short-circuits it.
    await db.tracked_promise.update({
      where: { id: p.id },
      data: { status: "NUDGED", nudged_at: new Date() },
    });
  } else {
    const graphClient = await getGraphClient(p.user_id);

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
        return { status: "skipped", reason: "message deleted" };
      }
      throw err;
    }

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

    // Move mints a NEW id; mark it processed so the move's own "created"
    // notification on the watched Follow up folder isn't misread as a delivery.
    const moved = await graphClient
      .api(`/me/messages/${p.message_id}/move`)
      .post({ destinationId: folderId });
    const newId = moved.id as string;
    await markMessageProcessed(newId);
    await graphClient.api(`/me/messages/${newId}`).patch({ isRead: false });
    draftMessageId = newId;

    // Claim + repoint at the moved id (the old id no longer exists post-move).
    await db.tracked_promise.update({
      where: { id: p.id },
      data: { status: "NUDGED", nudged_at: new Date(), message_id: newId },
    });
  }

  // Spend the one follow-up unit for this nudge, now that we've committed to
  // surfacing it (the email + draft below are all part of this single unit).
  await incrementFollowUpCount(p.user_id);

  // ---- 2. Ping the user over email ----
  try {
    let firstName: string | null = null;
    try {
      const clerk = await clerkClient();
      const clerkUser = await clerk.users.getUser(p.user_id);
      firstName = clerkUser.firstName ?? clerkUser.fullName ?? null;
    } catch {
      // Name is best-effort; send with a generic greeting rather than skip.
    }
    if (p.user_tokens?.email) {
      await sendPromiseDueEmail({
        to: p.user_tokens.email,
        firstName,
        item,
        recipient: to,
        dueLabel,
      });
    }
  } catch (err: any) {
    console.error(
      `[promise-nudge] reminder email failed for ${p.id}: ${err?.message ?? err}`,
    );
  }

  // ---- 3. Pre-written delivery draft (only if the user keeps AI drafts on) ----
  try {
    if (pref.ai_drafts !== false) {
      const draftBody = await generateOutboundPromiseDraft({
        subject,
        item,
        to,
        dueLabel,
      });
      if (draftBody) {
        if (isGmail) {
          await createGmailDraft(
            p.user_id,
            p.thread_id,
            draftMessageId,
            subject,
            to,
            draftBody,
            draftPref.fontColor,
            draftPref.fontSize,
            draftPref.signature,
          );
        } else {
          await createOutlookDraft(
            p.user_id,
            draftMessageId,
            subject,
            to,
            draftBody,
            draftPref.fontColor,
            draftPref.fontSize,
            draftPref.signature,
          );
        }
      }
    }
  } catch (err: any) {
    console.error(
      `[promise-nudge] draft creation failed for ${p.id}: ${err?.message ?? err}`,
    );
  }

  console.log(
    `[promise-nudge] Nudged outbound promise ${p.id} on thread ${p.thread_id} (${isGmail ? "gmail" : "outlook"})`,
  );
  return { status: "success" };
}

export default processPromiseNudge;
