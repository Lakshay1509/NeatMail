import { db } from "./prisma";
import { getPreviousMails } from "./gmail";
import { getPreviousOutlookMails } from "./outlook";
import { encryptDomain } from "./encode";
import { engagementScanQueue, onboardScanJobId } from "./queue";
import { isMemberAccessPaused } from "./organization";

// Call only via mailboxActivationQueue (lib/queue.ts), not directly — the only caller is bullmq/workers/mailbox-activation.ts.

/** Durable "already activated" signal: watch_activated and last_history_id reset on deactivation, but email_tracked rows persist. */
export async function hasSyncedHistory(userId: string): Promise<boolean> {
  const row = await db.email_tracked.findFirst({
    where: { user_id: userId },
    select: { message_id: true },
  });
  return row !== null;
}

/** Never throws: a failed backfill shouldn't burn the BullMQ job's retries, since retrying just re-fetches the same messages; the worker throws separately when watch setup fails. */
export async function activateMailbox(userId: string): Promise<void> {
  try {
    const token = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true, deleted_flag: true },
    });
    if (!token || token.deleted_flag) return;

    // Defense in depth: callers already check this, but a paused mailbox must never be ingested here.
    if (await isMemberAccessPaused(userId)) return;

    // Skip if already synced — refetching wastes Gmail quota and the PK dedupe drops it anyway; mail from a lapse isn't backfilled, watch just resumes from the current historyId.
    if (await hasSyncedHistory(userId)) return;

    if (token.is_gmail) {
      const mails = await getPreviousMails(userId);
      if (mails && mails.length > 0) {
        const insertData = await Promise.all(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mails.map(async (mail: any) => ({
            user_id: userId,
            message_id: mail.messageId,
            domain: await encryptDomain(mail.senderEmail),
            is_read: mail.is_read,
            created_at: new Date(mail.date),
          })),
        );
        await db.email_tracked.createMany({
          data: insertData,
          skipDuplicates: true,
        });
      }
    } else {
      const mails = await getPreviousOutlookMails(userId);
      if (mails && mails.length > 0) {
        const insertData = await Promise.all(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mails.map(async (mail: any) => ({
            user_id: userId,
            message_id: mail.messageId,
            domain: await encryptDomain(mail.fullemail),
            is_read: mail.is_Read,
            created_at: new Date(mail.created_at),
          })),
        );
        await db.email_tracked.createMany({
          data: insertData,
          skipDuplicates: true,
        });
      }
    }

    // Runs after backfill on purpose — scanning first would find no history and show a zero on /onboard-complete.
    try {
      await engagementScanQueue.add(
        "scan-user",
        { userId, notify: true },
        { jobId: onboardScanJobId(userId) },
      );
    } catch (err) {
      console.error(
        "[activate-mailbox] engagement scan enqueue failed (non-fatal):",
        err,
      );
    }
  } catch (err) {
    console.error("[activate-mailbox] failed for", userId, err);
  }
}
