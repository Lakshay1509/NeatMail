import { db } from "@/lib/prisma";
import { decryptDomain, decrypt } from "./encode";

export interface DigestEmail {
  message_id: string;
  subject: string;
  from: string;
  domain: string | null;
  ai_summary: string | null;
  ai_action: string | null;
  created_at: Date;
  tag_name: string;
  tag_color: string;
}

export interface DigestGroup {
  urgency: "urgent" | "needs_reply" | "new_today";
  label: string;
  emails: DigestEmail[];
}

const URGENT_ACTIONS = [
  "Escalate now",
  "Investigate now",
];

const NEEDS_REPLY_ACTIONS = [
  "Reply with ETA",
  "Review & approve",
  "Send feedback",
  "Confirm availability",
  "Approve invoices",
  "Submit proposal",
];

const REVIEW_ACTIONS = [
  "Read later",
  "Review billing",
  "Check activity",
  "Renew or review",
];

function isUrgent(email: DigestEmail): boolean {
  const action = email.ai_action || "";
  if (URGENT_ACTIONS.includes(action)) return true;

  const ageHours =
    (Date.now() - new Date(email.created_at).getTime()) / (1000 * 60 * 60);
  return ageHours > 48;
}

function isNeedsReply(email: DigestEmail): boolean {
  const action = email.ai_action || "";
  return NEEDS_REPLY_ACTIONS.includes(action);
}

export async function getDigestForUser(
  userId: string,
): Promise<DigestGroup[]> {
  const since = new Date();
  since.setDate(since.getDate() - 1);

  const rows = await db.email_tracked.findMany({
    where: {
      user_id: userId,
      is_read: false,
      archive_at: null,
      OR: [{ snoozed_until: null }, { snoozed_until: { lt: new Date() } }],
      tag: {
        name: { in: ["Action Needed", "Pending Response"] },
      },
      created_at: { gte: since },
    },
    include: {
      tag: {
        select: { name: true, color: true },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const emails: DigestEmail[] = await Promise.all(
  rows.map(async (r): Promise<DigestEmail> => ({
    message_id: r.message_id,
    subject: r.message_id,
    from: r.domain ? await decryptDomain(r.domain) : "Unknown",
    domain: r.domain,
    ai_summary: r.ai_summary ? await decrypt(r.ai_summary) : null,
    ai_action: r.ai_action ? await decrypt(r.ai_action) : null,
    created_at: r.created_at,
    tag_name: r.tag?.name || "",
    tag_color: r.tag?.color || "",
  }))
);

  const urgent: DigestEmail[] = [];
  const needsReply: DigestEmail[] = [];
  const newToday: DigestEmail[] = [];

  for (const email of emails) {
    if (isUrgent(email)) {
      urgent.push(email);
    } else if (isNeedsReply(email)) {
      needsReply.push(email);
    } else {
      newToday.push(email);
    }
  }

  const groups: DigestGroup[] = [];
  if (urgent.length > 0) {
    groups.push({ urgency: "urgent", label: "Urgent — Do now", emails: urgent });
  }
  if (needsReply.length > 0) {
    groups.push({
      urgency: "needs_reply",
      label: "Needs Your Response",
      emails: needsReply,
    });
  }
  if (newToday.length > 0) {
    groups.push({
      urgency: "new_today",
      label: "New Since Yesterday",
      emails: newToday,
    });
  }

  return groups;
}

export function trimDigestForEmail(
  groups: DigestGroup[],
  maxItems: number,
): { groups: DigestGroup[]; remainingCount: number } {
  const totalItems = groups.reduce((sum, g) => sum + g.emails.length, 0);
  if (totalItems <= maxItems) {
    return { groups, remainingCount: 0 };
  }

  const priorityOrder: DigestGroup["urgency"][] = [
    "urgent",
    "needs_reply",
    "new_today",
  ];

  const trimmed: DigestGroup[] = [];
  let taken = 0;

  for (const urgency of priorityOrder) {
    const group = groups.find((g) => g.urgency === urgency);
    if (!group) continue;

    const remaining = maxItems - taken;
    if (remaining <= 0) break;

    trimmed.push({
      ...group,
      emails: group.emails.slice(0, remaining),
    });
    taken += Math.min(group.emails.length, remaining);
  }

  return {
    groups: trimmed,
    remainingCount: totalItems - taken,
  };
}

export async function getDigestCount(userId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 1);

  return db.email_tracked.count({
    where: {
      user_id: userId,
      is_read: false,
      archive_at: null,
      OR: [{ snoozed_until: null }, { snoozed_until: { lt: new Date() } }],
      tag: {
        name: { in: ["Action Needed", "Pending Response"] },
      },
      created_at: { gte: since },
    },
  });
}

export async function markEmailAsDone(
  userId: string,
  messageId: string,
): Promise<void> {
  await db.email_tracked.update({
    where: { user_id_message_id: { user_id: userId, message_id: messageId } },
    data: { is_read: true },
  });
}

export async function snoozeEmail(
  userId: string,
  messageId: string,
  until: Date,
): Promise<void> {
  await db.email_tracked.update({
    where: { user_id_message_id: { user_id: userId, message_id: messageId } },
    data: { snoozed_until: until },
  });
}
