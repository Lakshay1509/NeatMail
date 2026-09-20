// Live progress copy for the chat agent.
//
// The agent already runs a visible sequence of tool calls (search → read →
// draft → …). We surface each step to the browser over SSE so a 20–30s request
// reads as "the assistant is doing things", not a frozen spinner. Keep the copy
// short, present-tense, and honest — every label maps to work actually running.

export type AgentEvent =
  | {
      type: "status";
      /** User-facing line while it runs, e.g. "Searching your inbox…". */
      label: string;
      /** Past-tense form shown once the step completes. */
      doneLabel?: string;
      /** The tool that triggered it, when applicable (lets the UI pick an icon). */
      tool?: string;
    }
  /** A chunk of the answer as the model writes it, so the reply appears live. */
  | { type: "delta"; text: string };

// [while running, once finished] — the trace keeps every step on screen, so a
// finished one must stop claiming to still be happening.
const TOOL_STATUS: Record<string, [string, string]> = {
  search_mail: ["Searching your inbox…", "Searched your inbox"],
  read_email: ["Reading that email…", "Read that email"],
  find_attachment: ["Digging up that file…", "Found that file"],
  draft_reply: ["Drafting your reply…", "Drafted your reply"],
  get_availability: ["Checking your calendar…", "Checked your calendar"],
  draft_calendar_reply: ["Finding open times to offer…", "Offered open times"],
  who_am_i_waiting_on: ["Checking who you're waiting on…", "Checked who you're waiting on"],
  list_commitments: ["Checking open promises…", "Checked open promises"],
  draft_nudge: ["Writing a follow-up nudge…", "Wrote a follow-up nudge"],
  trash_emails: ["Lining those up to trash…", "Lined those up to trash"],
  archive_emails: ["Lining those up to archive…", "Lined those up to archive"],
  bulk_cleanup: ["Rounding up emails to clean up…", "Rounded up the cleanup"],
  unsubscribe: ["Setting up the unsubscribe…", "Set up the unsubscribe"],
};

/** Emitted the moment the request lands, before the first model call. */
export const START_STATUS = "Reading your request…";
export const START_STATUS_DONE = "Read your request";
/** Emitted between iterations while the model reasons over tool results. */
export const THINKING_STATUS = "Working out what matters…";
export const THINKING_STATUS_DONE = "Worked out what matters";

export function statusForTool(name: string): [string, string] {
  return TOOL_STATUS[name] ?? ["Working on it…", "Done"];
}
