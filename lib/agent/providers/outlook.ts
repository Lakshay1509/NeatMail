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

/** Strip Gmail-style operators the model may emit — Outlook $search is keyword-only. */
function extractKeywords(raw: string): string {
  return raw
    .replace(/"/g, "")
    .split(/\s+/)
    .filter((t) => {
      const upper = t.toUpperCase();
      return (
        !t.includes(":") && upper !== "AND" && upper !== "OR" && upper !== "NOT"
      );
    })
    .join(" ")
    .trim();
}

interface GraphMsg {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  bodyPreview?: string;
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
    const keywords = extractKeywords(query);
    const select =
      "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview";
    try {
      if (!keywords) {
        const res = await client
          .api("/me/messages")
          .top(maxResults)
          .select(select)
          .orderby("receivedDateTime desc")
          .get();
        return (res.value ?? []).map(toItem);
      }
      const res = await client
        .api("/me/messages")
        .search(`"${keywords}"`)
        .top(maxResults)
        .select(select)
        .get();
      return (res.value ?? []).map(toItem);
    } catch (err) {
      console.error("[OutlookProvider] search failed", err);
      return [];
    }
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

    if (spec.query) {
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
    olderThanDays: number,
    maxResults: number,
  ): Promise<SentAwaitingReply[]> {
    const res = await getSentEmailsOutlook(this.userId, {
      olderThan: olderThanDays,
      maxResults,
    });
    return res.data.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      subject: m.subject,
      to: m.to,
      date: m.date,
    }));
  }
}
