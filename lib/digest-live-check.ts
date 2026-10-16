// Drops digest emails the user already handled outside NeatMail (archived, deleted or replied) by checking the live mailbox.
import { getGmailClient, withRetry } from "@/lib/gmail";
import { getGraphClient, outlookRetry } from "@/lib/outlook";
import { db } from "@/lib/prisma";
import type { DigestGroup } from "@/lib/digest";

const isNotFound = (err: unknown) => {
  const e = err as { code?: number; status?: number; statusCode?: number };
  return e?.code === 404 || e?.status === 404 || e?.statusCode === 404;
};

// Returns a per-message "already handled?" check. Any error other than a 404
// (after retries) counts as "not handled", so a flaky call keeps the email in the digest.
async function getHandledCheck(
  userId: string,
  isGmail: boolean,
): Promise<(messageId: string) => Promise<boolean>> {
  if (isGmail) {
    const gmail = await getGmailClient(userId);
    return async (messageId) => {
      try {
        const msg = await withRetry(() =>
          gmail.users.messages.get({ userId: "me", id: messageId, format: "minimal" }),
        );
        const { labelIds, threadId, internalDate } = msg.data;
        // The docs only promise "ID and labels" for minimal, so a missing field
        // keeps the email instead of guessing (a 0 date would make any earlier
        // sent mail look like a reply). https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format
        if (!labelIds) return false;
        if (labelIds.includes("TRASH") || !labelIds.includes("INBOX")) return true;
        if (!threadId || !internalDate) return false;

        const thread = await withRetry(() =>
          gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" }),
        );
        const receivedAt = Number(internalDate);
        return (thread.data.messages ?? []).some(
          (m) =>
            m.labelIds?.includes("SENT") &&
            Number(m.internalDate ?? 0) > receivedAt,
        );
      } catch (err) {
        return isNotFound(err);
      }
    };
  }

  const client = await getGraphClient(userId);
  return async (messageId) => {
    try {
      const msg = await outlookRetry(() =>
        client
          .api(`/me/messages/${messageId}`)
          .select("conversationId,receivedDateTime")
          .get(),
      );
      if (!msg.conversationId || !msg.receivedDateTime) return false;

      // Normalised to plain UTC; DateTimeOffset literals go unquoted in $filter.
      // https://learn.microsoft.com/en-us/graph/filter-query-parameter
      const receivedAt = new Date(msg.receivedDateTime).toISOString();
      const conversationId = String(msg.conversationId).replace(/'/g, "''");
      const sent = await outlookRetry(() =>
        client
          .api("/me/mailFolders('sentitems')/messages")
          .filter(`sentDateTime gt ${receivedAt} and conversationId eq '${conversationId}'`)
          .select("id")
          .top(1)
          .get(),
      );
      return (sent.value?.length ?? 0) > 0;
    } catch (err) {
      // Outlook ids change on every move and NeatMail repoints its own moves,
      // so a 404 means the user archived, filed or deleted it.
      // https://learn.microsoft.com/en-us/graph/outlook-immutable-id
      return isNotFound(err);
    }
  };
}

// Checks emails in priority order, `limit` at a time, until enough live ones
// remain to fill the digest. Handled ones are marked done so the dashboard clears too.
// shortcut: only the first `limit * 3` emails are checked (caps quota and cron time per user), so "+N more" can include handled mail; raise the cap if users notice.
export async function dropHandledEmails(
  userId: string,
  isGmail: boolean,
  groups: DigestGroup[],
  limit: number,
): Promise<DigestGroup[]> {
  const emails = groups.flatMap((g) => g.emails);
  if (emails.length === 0) return groups;

  let isHandled: (messageId: string) => Promise<boolean>;
  try {
    isHandled = await getHandledCheck(userId, isGmail);
  } catch (err) {
    console.error("[digest-live-check] No mailbox client, sending unchecked:", err);
    return groups;
  }

  const maxChecks = Math.min(emails.length, limit * 3);
  const handled = new Set<string>();
  let kept = 0;
  for (let i = 0; i < maxChecks && kept < limit; i += limit) {
    const batch = emails.slice(i, Math.min(i + limit, maxChecks));
    const results = await Promise.all(batch.map((e) => isHandled(e.message_id)));
    batch.forEach((e, j) => (results[j] ? handled.add(e.message_id) : kept++));
  }

  if (handled.size === 0) return groups;

  await db.email_tracked.updateMany({
    where: { user_id: userId, message_id: { in: [...handled] } },
    data: { isDone: true },
  });

  return groups
    .map((g) => ({ ...g, emails: g.emails.filter((e) => !handled.has(e.message_id)) }))
    .filter((g) => g.emails.length > 0);
}
