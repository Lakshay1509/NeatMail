import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { getUserTier } from "@/lib/tier-guard";
import { getUserSubscribed } from "@/lib/supabase";
import { runFirstRunSweep, undoFirstRunSweep } from "@/lib/first-run-sweep";

interface FirstSweepJob {
  userId: string;
  action: "run" | "undo";
  buckets?: string[];
}

// Runs the first-run inbox sweep (or undoes it) off the request path, so a huge
// backlog never blocks the API call. Gated the same way the archive-backlog
// worker is: skip deleted, lapsed, or free accounts.
export async function processFirstSweep(job: Job<FirstSweepJob>) {
  const { userId, action, buckets } = job.data;

  const token = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { deleted_flag: true, is_gmail: true },
  });

  if (!token || token.deleted_flag) return;
  // Gmail-only for now — the buckets are Gmail categories.
  if (!token.is_gmail) return;

  if (action === "undo") {
    await undoFirstRunSweep(userId);
    // Reset the stamp so the banner can offer the sweep again.
    await db.user_tokens.update({
      where: { clerk_user_id: userId },
      data: { first_sweep_at: null, first_sweep_count: 0 },
    });
    return;
  }

  const tier = await getUserTier(userId);
  if (tier === "FREE") return;

  const subStatus = await getUserSubscribed(userId);
  if (!subStatus.subscribed) return;

  const result = await runFirstRunSweep(userId, buckets);

  await db.user_tokens.update({
    where: { clerk_user_id: userId },
    data: {
      // Set the stamp on completion (the route sets it optimistically too; this
      // keeps it correct even if that write was rolled back).
      first_sweep_at: new Date(),
      first_sweep_count: result.archived,
    },
  });

  // Throw on partial failure so BullMQ retries. The sweep is idempotent —
  // already-archived mail is simply re-matched out, so a retry only mops up what
  // is still in the inbox.
  if (result.failed > 0) {
    throw new Error(
      `First-run sweep for user ${userId} left ${result.failed} message(s) unarchived`,
    );
  }
}
