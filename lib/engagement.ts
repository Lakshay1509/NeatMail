import { db } from "@/lib/prisma";
import { getUserTier } from "@/lib/tier-guard";
import { getUserSubscribed } from "@/lib/supabase";

// Tunable thresholds for the noisy-sender engagement scan. A sender is only
// auto-muted when every guard below passes, so the default bias is toward
// leaving mail in the inbox over hiding something the user actually reads.
export const ENGAGEMENT_CONFIG = {
  // Trailing window the scan looks back over.
  windowDays: 30,
  // "Opened anything in the last N days" cancels a mute — protects burst
  // readers who ignore a newsletter for a while then binge several at once.
  recentOpenDays: 14,
  // Need enough volume before judging a sender at all.
  minMessages: 8,
  // At most this fraction of the sender's mail may have been opened.
  maxReadRate: 0.1,
  // Mail must be spread across at least this many distinct days, so a single
  // one-day promo blast can't trip the mute on its own.
  minDistinctDays: 3,
} as const;

// Categories that must never be auto-muted, matching the exclusions in
// lib/archive-rules.ts and the mail workers. Any mail in these buckets during
// the window rules the sender out entirely, protecting semi-transactional
// senders (banks, calendars, invoices) that otherwise look like marketing.
const IMPORTANT_CATEGORIES = [
  "Action Needed",
  "Pending Response",
  "Finance",
  "Event update",
] as const;

interface SenderEngagementRow {
  domain: string;
  total: bigint;
  reads: bigint;
  recent_reads: bigint;
  distinct_days: bigint;
  important_count: bigint;
}

// Finds noisy-but-ignored senders for one user and creates AUTO archive rules
// for any that qualify and don't already have a rule. "Already have a rule"
// covers both an active one (already handled) and a deactivated Undo
// tombstone, which we must never re-mute. Returns the number of rules created.
//
// `domain` is the deterministically-encrypted sender identity, so we can
// group on it and write it straight back as the rule's domain without ever
// decrypting. That also matches what the mail workers re-derive on arrival.
export async function scanUserForNoisySenders(userId: string): Promise<number> {
  const now = Date.now();
  const windowDate = new Date(now - ENGAGEMENT_CONFIG.windowDays * 86_400_000);
  const recentDate = new Date(
    now - ENGAGEMENT_CONFIG.recentOpenDays * 86_400_000,
  );

  const rows = await db.$queryRaw<SenderEngagementRow[]>`
    SELECT et.domain AS domain,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE et."isRead") AS reads,
           COUNT(*) FILTER (WHERE et."isRead" AND et.created_at >= ${recentDate}) AS recent_reads,
           COUNT(DISTINCT (et.created_at)::date) AS distinct_days,
           COUNT(*) FILTER (
             WHERE t.name IN ('Action Needed', 'Pending Response', 'Finance', 'Event update')
           ) AS important_count
    FROM "email_tracked" et
    LEFT JOIN "tag" t ON t.id = et.tag_id
    WHERE et.user_id = ${userId}
      AND et.domain IS NOT NULL
      AND et.created_at >= ${windowDate}
    GROUP BY et.domain
    HAVING COUNT(*) >= ${ENGAGEMENT_CONFIG.minMessages}
  `;

  const qualifying = rows
    .filter((r) => {
      const total = Number(r.total);
      const reads = Number(r.reads);
      const recentReads = Number(r.recent_reads);
      const distinctDays = Number(r.distinct_days);
      const important = Number(r.important_count);

      if (important > 0) return false; // has actionable/finance mail
      if (recentReads > 0) return false; // opened something recently
      if (distinctDays < ENGAGEMENT_CONFIG.minDistinctDays) return false;
      if (reads > total * ENGAGEMENT_CONFIG.maxReadRate) return false;
      return true;
    })
    .map((r) => r.domain);

  if (qualifying.length === 0) return 0;

  // Skip senders that already have a rule, active or not: an active rule is
  // already doing the job, and a deactivated one is an Undo tombstone we must
  // not resurrect.
  const existing = await db.archiveRule.findMany({
    where: { user_id: userId, domain: { in: qualifying } },
    select: { domain: true },
  });
  const existingDomains = new Set(existing.map((e) => e.domain));
  const toCreate = qualifying.filter((d) => !existingDomains.has(d));

  if (toCreate.length === 0) return 0;

  // archiveAfterDays 0: the mail workers archive new mail on arrival, and the
  // daily sweep clears whatever backlog is already in the inbox.
  const result = await db.archiveRule.createMany({
    data: toCreate.map((domain) => ({
      user_id: userId,
      domain,
      archiveAfterDays: 0,
      isActive: true,
      source: "AUTO" as const,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

// Iterates every subscribed (non-FREE) user and runs the scan. Invoked by the
// engagement-scan BullMQ repeatable job. Errors are isolated per user so one bad
// mailbox can't abort the whole run.
export async function runEngagementScan(): Promise<{
  usersScanned: number;
  rulesCreated: number;
}> {
  const users = await db.user_tokens.findMany({
    where: { deleted_flag: false },
    select: { clerk_user_id: true },
  });

  let usersScanned = 0;
  let rulesCreated = 0;

  for (const u of users) {
    try {
      const tier = await getUserTier(u.clerk_user_id);
      if (tier === "FREE") continue;

      const sub = await getUserSubscribed(u.clerk_user_id);
      if (!sub.subscribed) continue;

      rulesCreated += await scanUserForNoisySenders(u.clerk_user_id);
      usersScanned++;
    } catch (err) {
      console.error(`[engagement-scan] failed for ${u.clerk_user_id}:`, err);
    }
  }

  return { usersScanned, rulesCreated };
}

// Called when a user reads a message we auto-archived: un-mutes the sender so
// their mail returns to the inbox. This deactivates the rule instead of
// deleting it, same as explicit Undo, because the scan skips any sender that
// already has a rule. Deleting it would let the next scan re-mute the sender
// within ~6h whenever the read message arrived more than recentOpenDays ago
// (the scan's "recent open" guard checks arrival date, not read date).
// Returns whether a rule was deactivated.
export async function unmuteSenderOnRead(
  userId: string,
  domain: string,
): Promise<boolean> {
  const updated = await db.archiveRule.updateMany({
    where: { user_id: userId, domain, source: "AUTO", isActive: true },
    data: { isActive: false },
  });
  return updated.count > 0;
}

export { IMPORTANT_CATEGORIES };
