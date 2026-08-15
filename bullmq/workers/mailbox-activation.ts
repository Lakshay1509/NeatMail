import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { handleWatchActivation } from "@/lib/payement";
import { activateMailbox } from "@/lib/mailbox-activation";

// Both the DodoPay webhook and POST /api/onboard enqueue this with the same
// activationJobId(userId), so BullMQ drops the second and only one backfill/watch runs.

interface MailboxActivationJob {
  userId: string;
}

export async function processMailboxActivation(
  job: Job<MailboxActivationJob>,
): Promise<void> {
  const { userId } = job.data;

  // Re-arming an already-armed watch would create a duplicate Outlook subscription.
  const token = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { watch_activated: true },
  });

  let watchArmed = token?.watch_activated ?? false;
  if (!watchArmed) {
    watchArmed = await handleWatchActivation(userId);
  }

  // Never throws; safe to retry (no-ops via hasSyncedHistory).
  await activateMailbox(userId);

  // Thrown last so activateMailbox still runs; lets BullMQ retry and surface a permanent failure in Bull Board.
  if (!watchArmed) {
    throw new Error(`Watch activation failed for ${userId}`);
  }
}
