import type { OpenAI } from "openai";

// Shared contracts for the NeatMail chat agent (v2).
//
// The agent is provider-agnostic: every tool is written against `MailProvider`,
// and `GmailProvider` / `OutlookProvider` adapt the existing lib/gmail.ts and
// lib/outlook.ts helpers to this one interface. This is what kills the ~900
// lines of duplicated Gmail/Outlook tool code the old chat carried.

export type ProviderKind = "gmail" | "outlook";

/** A normalized inbox search hit. `id` is the stable, groundable message id. */
export interface MailSearchItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet: string;
}

export interface AttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

/** An attachment plus the header context of the email that carried it. */
export interface AttachmentCandidate extends AttachmentMeta {
  from: string;
  date: string;
  subject: string;
}

/** Draft styling pulled from `draft_preference`, loaded once per request. */
export interface DraftPrefs {
  fontColor: string;
  fontSize: number;
  signature: string | null;
}

export interface FileAttachment {
  filename: string;
  mimeType: string;
  /** Standard (NOT url-safe) base64. */
  base64: string;
}

export interface CreatedDraft {
  draftId?: string;
  subject: string;
  to: string;
}

export interface SentAwaitingReply {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
}

export interface UnsubscribeResult {
  success: boolean;
  method?: string;
  requiresRedirect?: boolean;
  redirectUrl?: string;
}

export interface BulkResult {
  success: boolean;
  count: number;
  ids: string[];
  message?: string;
}

/** Structured, provider-neutral filter for bulk cleanup / triage. */
export interface SearchFilterSpec {
  /** Free-text keywords (Outlook $search; folded into the Gmail query). */
  query?: string;
  from?: string;
  /** Gmail categories only — ignored by Outlook (no equivalent). */
  category?: "promotions" | "updates" | "social" | "forums";
  newerThanDays?: number;
  olderThanDays?: number;
}

/**
 * The single abstraction every tool talks to. Both concrete providers wrap
 * already-tested functions in lib/gmail.ts / lib/outlook.ts — no new mailbox
 * API logic lives here, only normalization.
 */
export interface MailProvider {
  readonly kind: ProviderKind;
  readonly userId: string;

  /** Provider-native search. Gmail: operator query. Outlook: keyword $search. */
  search(query: string, maxResults: number): Promise<MailSearchItem[]>;
  /** Structured search used by bulk cleanup (date ranges, sender, category). */
  searchFiltered(spec: SearchFilterSpec, maxResults: number): Promise<MailSearchItem[]>;

  getBody(messageId: string): Promise<string>;

  listAttachments(messageId: string): Promise<AttachmentMeta[]>;
  downloadAttachment(messageId: string, attachmentId: string): Promise<string>;
  /** Gather candidate files from a contact's threads (both directions). */
  gatherAttachmentCandidatesByContact(
    contact: string,
    maxMessages: number,
  ): Promise<AttachmentCandidate[]>;
  /** Gather candidate files by free-text keywords across the mailbox. */
  gatherAttachmentCandidatesByKeyword(
    keywords: string[],
    maxMessages: number,
  ): Promise<AttachmentCandidate[]>;

  /**
   * Create a reply DRAFT (never sends). Resolves subject/to/thread from the
   * message by default; `toOverride`/`subjectOverride` are used for nudges,
   * which reply to the user's OWN sent message but must address the recipient.
   */
  createReplyDraft(
    messageId: string,
    body: string,
    prefs: DraftPrefs,
    opts?: {
      attachments?: FileAttachment[];
      toOverride?: string;
      subjectOverride?: string;
    },
  ): Promise<CreatedDraft>;

  trash(messageIds: string[]): Promise<BulkResult>;
  archive(messageIds: string[]): Promise<BulkResult>;
  unsubscribe(messageId: string): Promise<UnsubscribeResult>;

  /** Recently-sent threads that appear to still be awaiting a reply. */
  getSentAwaitingReply(
    olderThanDays: number,
    maxResults: number,
  ): Promise<SentAwaitingReply[]>;
}

// ── Guardrail / confirmation types ──────────────────────────────────────────

export type PendingActionKind = "trash" | "archive" | "unsubscribe";

export interface PendingTarget {
  id: string;
  subject: string;
  from: string;
}

/** A destructive action staged for the user to confirm before it runs. */
export interface PendingAction {
  id: string;
  kind: PendingActionKind;
  targets: PendingTarget[];
  summary: string;
  createdAt: number;
}

// ── Tool context + registry ─────────────────────────────────────────────────

/** Everything a tool handler needs. One instance per chat request. */
export interface ToolContext {
  userId: string;
  provider: MailProvider;
  /** "api" for the web chat; a Telegram chat id otherwise. */
  channel: string;
  timezone: string;
  /** Download keys surfaced to the HTTP layer (mutated in place). */
  attachmentKeys: string[];
  /** Lazily-loaded, memoized draft styling. */
  getPrefs: () => Promise<DraftPrefs>;
  /** Set by a destructive tool to stage a confirmation. */
  pending: PendingAction | null;
}

export interface AgentTool {
  schema: OpenAI.Chat.ChatCompletionFunctionTool;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface AgentResult {
  response: string;
  attachments: { key: string; filename: string; mimeType: string }[];
  pendingConfirmation?: {
    id: string;
    kind: PendingActionKind;
    summary: string;
    targets: PendingTarget[];
  };
}
