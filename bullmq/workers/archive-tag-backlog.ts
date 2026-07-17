import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { getUserTier } from "@/lib/tier-guard";
import { getUserSubscribed } from "@/lib/supabase";
import { sweepArchiveRule } from "@/lib/archive-rules";

interface ArchiveBacklogJob {
  userId: string;
  tagId: string;
}

// Sweeps a tag rule's backlog right after the user enables it, instead of
// waiting for the daily cron. Only USER rules enqueue this; SEEDED defaults don't.
export async function processArchiveBacklog(job: Job<ArchiveBacklogJob>) {
  const { userId, tagId } = job.data;

  // Re-read at run time in case the rule was toggled or edited since enqueue.
  const rule = await db.archiveRule.findUnique({
    where: { user_id_tag_id: { user_id: userId, tag_id: tagId } },
    select: {
      user_id: true,
      domain: true,
      tag_id: true,
      archiveAfterDays: true,
      source: true,
      createdAt: true,
      isActive: true,
      user_tokens: { select: { deleted_flag: true } },
    },
  });

  if (!rule || !rule.isActive || rule.source !== "USER") return;

  // Mirror the cron's gates: deletion-scheduled, lapsed, or free accounts.
  if (rule.user_tokens?.deleted_flag) return;

  const tier = await getUserTier(userId);
  if (tier === "FREE") return;

  const subStatus = await getUserSubscribed(userId);
  if (!subStatus.subscribed) return;

  const result = await sweepArchiveRule(rule);

  // Throw on partial failure so BullMQ retries — the sweep is idempotent, so a
  // retry only picks up what's still unarchived.
  if (result.failed > 0) {
    throw new Error(
      `Archive backlog sweep for tag ${tagId} left ${result.failed} message(s) unarchived`,
    );
  }
}
