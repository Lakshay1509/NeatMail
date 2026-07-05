// Live progress copy for the chat agent.
//
// The agent already runs a visible sequence of tool calls (search → read →
// draft → …). We surface each step to the browser over SSE so a 20–30s request
// reads as "the assistant is doing things", not a frozen spinner. Keep the copy
// short, present-tense, and honest — every label maps to work actually running.

export interface AgentEvent {
  type: "status";
  /** User-facing line, e.g. "Searching your inbox…". */
  label: string;
  /** The tool that triggered it, when applicable (lets the UI pick an icon). */
  tool?: string;
}

/** One friendly line per tool the model can call. */
const TOOL_STATUS: Record<string, string> = {
  search_mail: "Searching your inbox…",
  read_email: "Reading that email…",
  find_attachment: "Digging up that file…",
  draft_reply: "Drafting your reply…",
  get_availability: "Checking your calendar…",
  draft_calendar_reply: "Finding open times to offer…",
  who_am_i_waiting_on: "Checking who you're waiting on…",
  draft_nudge: "Writing a follow-up nudge…",
  trash_emails: "Lining those up to trash…",
  archive_emails: "Lining those up to archive…",
  bulk_cleanup: "Rounding up emails to clean up…",
  unsubscribe: "Setting up the unsubscribe…",
};

/** Emitted the moment the request lands, before the first model call. */
export const START_STATUS = "Understanding your request…";
/** Emitted between iterations while the model reasons over tool results. */
export const THINKING_STATUS = "Thinking it through…";

export function statusForTool(name: string): string {
  return TOOL_STATUS[name] ?? "Working on it…";
}
