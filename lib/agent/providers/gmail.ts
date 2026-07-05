import {
  getGmailClient,
  getGmailMessageBody,
  searchGmail,
  getAttachment,
  downloadAttachment,
  createGmailDraft,
  archiveGmailMessages,
  trashMessages,
  unsubscribeFromEmail,
  getSentEmails,
} from "@/lib/gmail";
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

const MAX_CANDIDATE_MESSAGES = 20;

/** Adapts the Gmail helpers in lib/gmail.ts to the provider-agnostic MailProvider. */
export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  constructor(readonly userId: string) {}

  async search(query: string, maxResults: number): Promise<MailSearchItem[]> {
    const res = await searchGmail(this.userId, query, Math.min(maxResults, 25));
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

  async searchFiltered(
    spec: SearchFilterSpec,
    maxResults: number,
  ): Promise<MailSearchItem[]> {
    const parts: string[] = [];
    if (spec.query) parts.push(spec.query);
    if (spec.from) parts.push(`from:${spec.from}`);
    if (spec.category) parts.push(`category:${spec.category}`);
    if (spec.newerThanDays) parts.push(`newer_than:${spec.newerThanDays}d`);
    if (spec.olderThanDays) parts.push(`older_than:${spec.olderThanDays}d`);
    const query = parts.join(" ").trim();
    if (!query) return [];
    return this.search(query, maxResults);
  }

  getBody(messageId: string): Promise<string> {
    return getGmailMessageBody(this.userId, messageId);
  }

  async listAttachments(messageId: string): Promise<AttachmentMeta[]> {
    const files = await getAttachment(this.userId, messageId);
    return files.map((f) => ({
      messageId: f.messageId,
      attachmentId: f.attachmentId,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
    }));
  }

  downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    return downloadAttachment(this.userId, messageId, attachmentId);
  }

  private async gather(query: string): Promise<AttachmentCandidate[]> {
    const candidates: AttachmentCandidate[] = [];
    const search = await searchGmail(this.userId, query, MAX_CANDIDATE_MESSAGES);
    for (const msg of search.data) {
      const files = await getAttachment(this.userId, msg.id);
      for (const f of files) {
        candidates.push({
          messageId: f.messageId,
          attachmentId: f.attachmentId,
          filename: f.filename,
          mimeType: f.mimeType,
          size: f.size,
          from: msg.from,
          date: msg.date,
          subject: msg.subject ?? "",
        });
      }
    }
    return candidates;
  }

  gatherAttachmentCandidatesByContact(
    contact: string,
  ): Promise<AttachmentCandidate[]> {
    const clean = contact.replace(/["()\\]/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return Promise.resolve([]);
    return this.gather(`has:attachment (from:"${clean}" OR to:"${clean}")`);
  }

  gatherAttachmentCandidatesByKeyword(
    keywords: string[],
  ): Promise<AttachmentCandidate[]> {
    const orExpr = keywords
      .map((k) => k.replace(/["\\]/g, "").trim())
      .filter(Boolean)
      .map((k) => `"${k}"`)
      .join(" OR ");
    if (!orExpr) return Promise.resolve([]);
    return this.gather(`has:attachment (${orExpr})`);
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
    const gmail = await getGmailClient(this.userId);
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Subject", "From"],
    });
    const headers = msg.data.payload?.headers ?? [];
    const getH = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
      "";
    const subject = opts?.subjectOverride || getH("Subject");
    const to = opts?.toOverride || getH("From");
    const threadId = msg.data.threadId ?? messageId;

    const draft = await createGmailDraft(
      this.userId,
      threadId,
      messageId,
      subject,
      to,
      body,
      prefs.fontColor,
      prefs.fontSize,
      prefs.signature,
      opts?.attachments ?? [],
    );
    return { draftId: draft.id ?? undefined, subject, to };
  }

  async trash(messageIds: string[]): Promise<BulkResult> {
    const r = await trashMessages(this.userId, messageIds);
    return {
      success: r.success,
      count: r.trashed,
      ids: r.trashedIds ?? [],
      message: r.message,
    };
  }

  async archive(messageIds: string[]): Promise<BulkResult> {
    const r = await archiveGmailMessages(this.userId, messageIds);
    return {
      success: r.success,
      count: r.archived,
      ids: r.archivedIds ?? [],
      message: r.message,
    };
  }

  async unsubscribe(messageId: string): Promise<UnsubscribeResult> {
    return unsubscribeFromEmail(this.userId, messageId);
  }

  async getSentAwaitingReply(
    olderThanDays: number,
    maxResults: number,
  ): Promise<SentAwaitingReply[]> {
    const res = await getSentEmails(this.userId, {
      olderThan: olderThanDays,
      maxResults,
    });
    return res.data
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        subject: m.subject,
        to: m.to,
        date: m.date,
      }));
  }
}
