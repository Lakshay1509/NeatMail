import { db } from "@/lib/prisma";
import { archiveGmailMessages } from "@/lib/gmail";
import { archiveMessagesOutlook } from "@/lib/outlook";
import type { ArchiveRuleSource } from "@/prisma/generated/prisma/client";

// Categories an AUTO rule must never sweep out of the inbox, matching the
// mail workers' on-arrival guard and the scan exclusions in lib/engagement.ts.
// Otherwise a domain-only match would archive an important message that
// happens to arrive later from an already-muted sender.
const AUTO_ARCHIVE_EXCLUDED_CATEGORIES = [
  "Action Needed",
  "Pending Response",
  "Finance",
  "Event update",
];

// Minimal field set so both the cron and the immediate-sweep worker can
// `select` exactly these and pass them straight in.
export interface ArchiveRuleForSweep {
  user_id: string;
  domain: string | null;
  tag_id: string | null;
  archiveAfterDays: number;
  source: ArchiveRuleSource;
  createdAt: Date;
}

export interface SweepRuleResult {
  matched: number;
  archivedGmail: number;
  archivedOutlook: number;
  failed: number;
  errors: string[];
}

// Archives every message a rule matches and stamps archive_at on the ones that
// leave. Shared by the cron (loops per rule) and the manual-enable worker
// (calls once). `now` is injectable so a batch of rules shares one timestamp.
export async function sweepArchiveRule(
  rule: ArchiveRuleForSweep,
  now: Date = new Date(),
): Promise<SweepRuleResult> {
  const result: SweepRuleResult = {
    matched: 0,
    archivedGmail: 0,
    archivedOutlook: 0,
    failed: 0,
    errors: [],
  };

  const thresholdDate = new Date(now);
  thresholdDate.setDate(thresholdDate.getDate() - rule.archiveAfterDays);

  // SEEDED rules only touch mail arriving after the rule's createdAt — never a
  // back catalogue nobody asked about. USER rules have no such floor.
  const arrivedAfterRule =
    rule.source === "SEEDED" ? { gte: rule.createdAt } : {};

  // Exactly one of domain/tag_id is set (CHECK constraint). archive_at: null
  // means still in the inbox; stamped below to stop the next run reprocessing it.
  const messagesToArchive = await db.email_tracked.findMany({
    where: {
      user_id: rule.user_id,
      ...(rule.tag_id ? { tag_id: rule.tag_id } : { domain: rule.domain }),
      created_at: {
        lt: thresholdDate,
        ...arrivedAfterRule,
      },
      archive_at: null,
      // AUTO rules protect actionable/finance mail even when it later arrives
      // from an already-muted sender; USER/SEEDED rules archive the domain
      // wholesale (the user opted in explicitly).
      ...(rule.source === "AUTO"
        ? {
            NOT: {
              tag: { is: { name: { in: AUTO_ARCHIVE_EXCLUDED_CATEGORIES } } },
            },
          }
        : {}),
    },
    select: {
      message_id: true,
      user_tokens: {
        select: {
          is_gmail: true,
          clerk_user_id: true,
        },
      },
    },
  });

  if (messagesToArchive.length === 0) return result;
  result.matched = messagesToArchive.length;

  const gmailMessagesByUser = new Map<string, string[]>();
  const outlookMessagesByUser = new Map<string, string[]>();

  for (const msg of messagesToArchive) {
    const userId = msg.user_tokens.clerk_user_id;
    const bucket = msg.user_tokens.is_gmail
      ? gmailMessagesByUser
      : outlookMessagesByUser;
    const existing = bucket.get(userId) || [];
    existing.push(msg.message_id);
    bucket.set(userId, existing);
  }

  // Stamp whatever actually left the inbox, even on partial failure — gating on
  // the overall `success` flag would leave archived mail unstamped and it'd get
  // re-archived on every future run.
  for (const [userId, messageIds] of gmailMessagesByUser) {
    try {
      const archiveResult = await archiveGmailMessages(userId, messageIds);
      const archivedIds = archiveResult.archivedIds ?? [];
      if (archivedIds.length) {
        result.archivedGmail += archivedIds.length;
        await db.email_tracked.updateMany({
          where: { user_id: userId, message_id: { in: archivedIds } },
          data: { archive_at: now },
        });
      }
      result.failed += messageIds.length - archivedIds.length;
    } catch (error) {
      result.failed += messageIds.length;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to archive Gmail messages for user ${userId}: ${message}`);
      console.error(`Failed to archive Gmail messages for user ${userId}:`, error);
    }
  }

  for (const [userId, messageIds] of outlookMessagesByUser) {
    try {
      const archiveResult = await archiveMessagesOutlook(userId, messageIds);
      const archivedIds = archiveResult.archivedIds ?? [];
      if (archivedIds.length) {
        result.archivedOutlook += archivedIds.length;
        await db.email_tracked.updateMany({
          where: { user_id: userId, message_id: { in: archivedIds } },
          data: { archive_at: now },
        });
      }
      result.failed += messageIds.length - archivedIds.length;
    } catch (error) {
      result.failed += messageIds.length;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to archive Outlook messages for user ${userId}: ${message}`);
      console.error(`Failed to archive Outlook messages for user ${userId}:`, error);
    }
  }

  return result;
}
