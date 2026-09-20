import {
  getGraphClient,
  getOutlookMessageBody,
  createOutlookDraft,
  deleteOutlookMessage,
  archiveMessagesOutlook,
  unsubscribeFromEmailOutlook,
  listOutlookAttachments,
  downloadOutlookAttachment,
  searchOutlook,
  searchOutlookAttachmentsByContact,
  searchOutlookAttachmentsByKeyword,
  getSentEmailsOutlook,
} from "@/lib/outlook";
import type {
  AttachmentCandidate,
  AttachmentMeta,
  BulkResult,
  CreatedDraft,
  DraftPrefs,
  FileAttachment,
  MailProvider,
  MailSearchItem,
  SearchFilterSpec,
  SentAwaitingReply,
  UnsubscribeResult,
} from "../types";

const MAX_CANDIDATE_MESSAGES = 40;

const DAY_MS = 86400000;
const UNIT_DAYS: Record<string, number> = { d: 1, m: 30, y: 365 };
// Graph $search is KQL and understands these natively (display name, alias or address)
const KQL_PROPS = new Set(["from", "to", "cc", "subject", "participants"]);

/**
 * The model speaks Gmail operators (it knows them far better than KQL), so
 * translate the common ones: dates and unread go to $filter/KQL, in:sent picks
 * the folder. Gmail-only ones (category:, label:, is:starred, negations) have
 * no Outlook equivalent and are dropped.
 */
export function parseOutlookQuery(raw: string, now = Date.now()) {
  const terms: string[] = [];
  let since: Date | undefined;
  let until: Date | undefined;
  let sent = false;
  let unread = false;
  const tokens = raw.replace(/"/g, "").replace(/[()]/g, " ").split(/\s+/);
  for (const tok of tokens.filter(Boolean)) {
    if (tok.startsWith("-") || tok.endsWith(":") || /^(AND|OR|NOT)$/i.test(tok)) continue;
    const m = tok.match(/^([a-z_]+):(.+)$/i);
    if (!m) {
      terms.push(tok);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2].toLowerCase();
    const age = val.match(/^(\d+)([dmy])$/);
    const date = new Date(val.replace(/\//g, "-"));
    if (key === "from" && val === "me") sent = true;
    else if (key === "to" && val === "me") continue; // everything in the mailbox is
    else if (KQL_PROPS.has(key)) terms.push(`${key}:${m[2]}`);
    else if (key === "has" && val === "attachment") terms.push("hasAttachments:true");
    else if (key === "in" && val === "sent") sent = true;
    else if (key === "is" && val === "unread") unread = true;
    else if (age && (key === "newer_than" || key === "older_than")) {
      const d = new Date(now - Number(age[1]) * UNIT_DAYS[age[2]] * DAY_MS);
      if (key === "newer_than") since = d;
      else until = d;
    } else if (!Number.isNaN(date.getTime()) && key === "after") since = date;
    else if (!Number.isNaN(date.getTime()) && key === "before") until = date;
  }
  return { terms, since, until, sent, unread };
}

/** True when the query narrows anything; an all-dropped query would match everything. */
function narrows(q: ReturnType<typeof parseOutlookQuery>) {
  return q.terms.length > 0 || !!q.since || !!q.until || q.unread || q.sent;
}

interface GraphMsg {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  isDraft?: boolean;
}

function toItem(msg: GraphMsg): MailSearchItem {
  return {
    id: msg.id,
    threadId: msg.conversationId ?? "",
    subject: msg.subject ?? "",
    from:
      msg.from?.emailAddress?.address ?? msg.from?.emailAddress?.name ?? "",
    to: msg.toRecipients?.[0]?.emailAddress?.address ?? "",
    date: msg.receivedDateTime ?? "",
    snippet: msg.bodyPreview ?? "",
  };
}

/** Adapts the Microsoft Graph helpers in lib/outlook.ts to MailProvider. */
export class OutlookProvider implements MailProvider {
  readonly kind = "outlook" as const;
  constructor(readonly userId: string) {}

  async search(query: string, maxResults: number): Promise<MailSearchItem[]> {
    const client = await getGraphClient(this.userId);
    const q = parseOutlookQuery(query);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const req = client
      .api(q.sent ? "/me/mailFolders('sentitems')/messages" : "/me/messages")
      .top(maxResults)
      .select(
        "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,isDraft",
      );
    if (q.terms.length === 0) {
      // $orderby's property must lead the $filter or Graph rejects it as
      // InefficientFilter, hence the always-present lower bound
      const parts = [
        `receivedDateTime ge ${(q.since ?? new Date(0)).toISOString()}`,
      ];
      // exclusive, like Gmail's before:
      if (q.until) parts.push(`receivedDateTime lt ${q.until.toISOString()}`);
      if (q.unread) parts.push("isRead eq false");
      // NeatMail's own AI drafts would otherwise crowd the newest-mail list
      parts.push("isDraft eq false");
      const res = await req
        .filter(parts.join(" and "))
        .orderby("receivedDateTime desc")
        .get();
      return (res.value ?? []).map(toItem);
    }
    // $search can't be combined with $filter on messages, so dates ride in
    // the KQL. Explicit AND: KQL ORs repeated restrictions on one property,
    // which would turn a date range into "either bound". Newest-first.
    const kql = [...q.terms];
    if (q.since) kql.push(`received>=${ymd(q.since)}`);
    if (q.until) kql.push(`received<${ymd(q.until)}`);
    // the SDK doesn't encode query params; a stray & or # would split the URL
    const res = await req.search(encodeURIComponent(`"${kql.join(" AND ")}"`)).get();
    // ponytail: unread/draft are post-filtered in KQL mode, so it can return < maxResults
    return ((res.value ?? []) as GraphMsg[])
      .filter((m) => !m.isDraft && (!q.unread || m.isRead === false))
      .map(toItem);
  }

  async searchFiltered(
    spec: SearchFilterSpec,
    maxResults: number,
  ): Promise<MailSearchItem[]> {
    // Graph cannot combine $search with $filter. When keywords are present we
    // keyword-search then filter by date/sender client-side; otherwise we use a
    // pure OData $filter. Outlook has no promotions/category concept — ignored.
    const now = Date.now();
    const newerBound = spec.newerThanDays
      ? now - spec.newerThanDays * 86400000
      : undefined;
    const olderBound = spec.olderThanDays
      ? now - spec.olderThanDays * 86400000
      : undefined;

    // bulk_cleanup stages trash/archive from this: a query made only of
    // unsupported operators (category:, is:starred) must not fall through to
    // "newest mail in every folder", so treat it as no query at all
    if (spec.query && narrows(parseOutlookQuery(spec.query))) {
      const items = await this.search(spec.query, Math.min(maxResults * 2, 50));
      return items
        .filter((m) => {
          const t = Date.parse(m.date);
          if (newerBound && !(t >= newerBound)) return false;
          if (olderBound && !(t <= olderBound)) return false;
          if (
            spec.from &&
            !m.from.toLowerCase().includes(spec.from.toLowerCase())
          )
            return false;
          return true;
        })
        .slice(0, maxResults);
    }

    const parts: string[] = [];
    if (newerBound)
      parts.push(`receivedDateTime ge ${new Date(newerBound).toISOString()}`);
    if (olderBound)
      parts.push(`receivedDateTime le ${new Date(olderBound).toISOString()}`);
    if (spec.from)
      parts.push(`from/emailAddress/address eq '${spec.from.replace(/'/g, "''")}'`);
    if (parts.length === 0) return [];
    const res = await searchOutlook(this.userId, parts.join(" and "), maxResults);
    return res.data.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      subject: m.subject,
      from: m.from,
      to: m.to,
      date: m.date,
      snippet: m.snippet,
    }));
  }

  getBody(messageId: string): Promise<string> {
    return getOutlookMessageBody(this.userId, messageId);
  }

  listAttachments(messageId: string): Promise<AttachmentMeta[]> {
    return listOutlookAttachments(this.userId, messageId);
  }

  downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    return downloadOutlookAttachment(this.userId, messageId, attachmentId);
  }

  private async gather(
    headers: { messageId: string; from: string; date: string; subject: string }[],
  ): Promise<AttachmentCandidate[]> {
    const candidates: AttachmentCandidate[] = [];
    for (const h of headers) {
      const files = await listOutlookAttachments(this.userId, h.messageId);
      for (const f of files) {
        candidates.push({
          messageId: f.messageId,
          attachmentId: f.attachmentId,
          filename: f.filename,
          mimeType: f.mimeType,
          size: f.size,
          from: h.from,
          date: h.date,
          subject: h.subject ?? "",
        });
      }
    }
    return candidates;
  }

  async gatherAttachmentCandidatesByContact(
    contact: string,
  ): Promise<AttachmentCandidate[]> {
    const headers = await searchOutlookAttachmentsByContact(
      this.userId,
      contact,
      MAX_CANDIDATE_MESSAGES,
    );
    return this.gather(headers);
  }

  async gatherAttachmentCandidatesByKeyword(
    keywords: string[],
  ): Promise<AttachmentCandidate[]> {
    const headers = await searchOutlookAttachmentsByKeyword(
      this.userId,
      keywords,
      MAX_CANDIDATE_MESSAGES,
    );
    return this.gather(headers);
  }

  async createReplyDraft(
    messageId: string,
    body: string,
    prefs: DraftPrefs,
    opts?: {
      attachments?: FileAttachment[];
      toOverride?: string;
      subjectOverride?: string;
    },
  ): Promise<CreatedDraft> {
    const client = await getGraphClient(this.userId);
    const msg = (await client
      .api(`/me/messages/${messageId}`)
      .select("subject,from")
      .get()) as { subject?: string; from?: { emailAddress?: { address?: string } } };
    const subject = opts?.subjectOverride || msg.subject || "";
    const to = opts?.toOverride || msg.from?.emailAddress?.address || "";

    const draft = await createOutlookDraft(
      this.userId,
      messageId,
      subject,
      to,
      body,
      prefs.fontColor,
      prefs.fontSize,
      prefs.signature,
      opts?.attachments ?? [],
    );
    return { draftId: draft?.id ?? undefined, subject, to };
  }

  async trash(messageIds: string[]): Promise<BulkResult> {
    const results = await Promise.allSettled(
      messageIds.map((id) => deleteOutlookMessage(this.userId, id)),
    );
    const ids: string[] = [];
    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value.success) ids.push(r.value.messageId);
    });
    return {
      success: ids.length === messageIds.length,
      count: ids.length,
      ids,
    };
  }

  async archive(messageIds: string[]): Promise<BulkResult> {
    const r = await archiveMessagesOutlook(this.userId, messageIds);
    return {
      success: r.success,
      count: r.archived,
      ids: r.archivedIds ?? [],
      message: r.message,
    };
  }

  unsubscribe(messageId: string): Promise<UnsubscribeResult> {
    return unsubscribeFromEmailOutlook(this.userId, messageId);
  }

  async getSentAwaitingReply(
    newerThanDays: number,
    maxResults: number,
  ): Promise<SentAwaitingReply[]> {
    const res = await getSentEmailsOutlook(this.userId, {
      olderThan: 0,
      newerThan: newerThanDays,
      maxResults,
    });
    return res.data.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      subject: m.subject,
      to: m.to,
      date: m.date,
      snippet: m.snippet,
    }));
  }
}
