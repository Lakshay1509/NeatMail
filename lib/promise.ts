import OpenAI from "openai";
import { fromZonedTime } from "date-fns-tz/fromZonedTime";
import { formatInTimeZone } from "date-fns-tz";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// A commitment must resolve to a due date no further out than this. A parse that
// lands beyond it is almost always a wrong-year mistake ("the 18th" -> next year)
// and is dropped rather than tracked.
const MAX_HORIZON_DAYS = 400;
// Below this the model isn't sure enough; a wrong track is worse than no track.
const MIN_CONFIDENCE = 0.6;

// Cost gate: pure regex, zero tokens. The LLM extractor only runs on mail that
// clears this, which is a tiny fraction of the inbox: a real "they owe me"
// promise almost always contains BOTH a first-person commitment cue AND a
// temporal cue. False positives here only cost one nano call; false negatives
// lose a promise, so the cues lean generous.

// Senders that never make personal promises: newsletters, notifications, bots.
// Anchored to the start of the local part (or after . _ + -) and requires the
// "@", so it can't misfire on substrings of real human addresses. Deliberately
// excludes support@ / news@ / updates@, since those are often human-monitored
// and do make promises ("I'll get back to you Friday").
const AUTOMATED_FROM =
  /(?:^|[._+-])(?:no-?reply|do-?not-?reply|donotreply|notifications?|mailer-?daemon|postmaster|newsletter|bounces?|marketing|alerts?|billing)@/i;

// The sender committing to send/do/deliver something for the recipient.
const COMMITMENT_CUE =
  /\b(?:i(?:['’]?m| am) going to|i['’]?ll|i will|i shall|we['’]?ll|we will|let me (?:send|share|get|forward|pull)|i can (?:send|share|get|have)|(?:will|i['’]?ll|we['’]?ll) (?:send|share|forward|deliver|provide|revert|update|get back to you|circle back|follow up)|sending (?:it|this|that|them|the|over|you)|send (?:it|this|that|them|the)? ?over to you|get back to you|revert(?:ing)? (?:back )?to you|circle back|follow up with you|will (?:be )?(?:sent|shared|ready|delivered|provided|done|completed|forwarded)|you['’]?ll (?:have|get|receive)|(?:get|have) (?:it|this|that|them|the .{0,20}?) (?:to|for) you)\b/i;

// A deadline-ish expression. Month names only count when paired with a day
// number, so common modal words ("may") don't trip it.
const TEMPORAL_CUE =
  /\b(?:today|tonight|tomorrow|tmrw|tmw|eod|cob|asap|end of (?:the )?(?:day|week|month|business day)|by (?:the )?end of|this (?:week|month|afternoon|evening|morning)|next (?:week|month|business day)|(?:by |on |this |next |before )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri|sat|sun)|in \d+ (?:days?|weeks?|hours?|business days?)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}(?:st|nd|rd|th)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec))\b/i;

/**
 * Cheap pre-filter deciding whether an incoming email is worth an LLM look.
 * Runs on the already-fetched subject/body, so it costs nothing. Only when this
 * returns true do we spend a token on {@link extractInboundPromise}.
 */
export function isPromiseCandidate(input: {
  fromEmail: string;
  subject: string;
  body: string;
}): boolean {
  if (AUTOMATED_FROM.test(input.fromEmail)) return false;
  const haystack = `${input.subject}\n${input.body}`.slice(0, 6000);
  return COMMITMENT_CUE.test(haystack) && TEMPORAL_CUE.test(haystack);
}

// Extraction: one gpt-5-nano call, only on gated candidates. The model turns
// natural language into a local wall-clock date; code turns that into a UTC
// instant against the user's timezone (mirrors the calendar providers).

export interface ExtractedPromise {
  /** What the sender committed to deliver, as a short phrase. */
  item: string;
  /** Absolute UTC instant the commitment is due (stored as-is). */
  dueAt: Date;
  confidence: number;
}

export async function extractInboundPromise(input: {
  subject: string;
  body: string;
  fromEmail: string;
  receivedDate: Date;
  userTimezone: string;
}): Promise<ExtractedPromise | null> {
  const tz = input.userTimezone || "UTC";
  // Anchor relative dates ("tomorrow", "Friday") on when the mail actually
  // arrived, expressed in the recipient's own timezone.
  const receivedLabel = formatInTimeZone(
    input.receivedDate,
    tz,
    "EEEE, MMMM d, yyyy 'at' HH:mm",
  );

  const systemMessage =
    "You extract delivery commitments made TO the reader from an email they received. Output only the requested JSON.";

  const userMessage = `The reader received the email below. Extract a commitment the SENDER made to send, deliver, share, or do something FOR the reader by a specific deadline ("they owe me" promises).

Only count a promise where the SENDER is the one who will deliver. Do NOT count:
- things the READER promised to do
- vague intentions with no deadline ("I'll be in touch sometime")
- marketing/product "launching soon" copy
- questions or requests aimed at the reader

Resolve relative dates against the received time: ${receivedLabel} (timezone ${tz}).
- Return "dueLocal" as a local wall-clock time in that timezone, format "YYYY-MM-DD" (date only) or "YYYY-MM-DDTHH:mm" (with an explicit clock time). Do NOT include a timezone offset.
- If only a day is given (e.g. "by Friday", "the 18th"), return date only and set hasTime=false.
- "item" is a short noun phrase for what's owed (e.g. "the design deck", "the signed contract").
- confidence 0-1: how sure you are this is a real dated commitment by the sender.
- If there is no such promise, set hasPromise=false and leave other fields empty.

From: ${input.fromEmail}
Subject: ${input.subject}

Body:
${input.body.slice(0, 6000)}`;

  let rawContent = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 400,
      reasoning_effort: "low",
      seed: 42,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "InboundPromise",
          strict: true,
          schema: {
            type: "object",
            properties: {
              hasPromise: {
                type: "boolean",
                description:
                  "True only if the sender committed to deliver something for the reader by a deadline.",
              },
              item: {
                type: "string",
                description:
                  "Short noun phrase for what the sender owes. Empty when hasPromise is false.",
              },
              dueLocal: {
                type: "string",
                description:
                  "Local wall-clock due time, 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm', no timezone offset. Empty when hasPromise is false.",
              },
              hasTime: {
                type: "boolean",
                description: "True if an explicit clock time was stated.",
              },
              confidence: {
                type: "number",
                description: "0-1 confidence this is a real dated commitment.",
              },
            },
            required: ["hasPromise", "item", "dueLocal", "hasTime", "confidence"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    });
    rawContent = completion.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("[extractInboundPromise] OpenAI call failed:", err);
    return null;
  }

  if (!rawContent) return null;

  let parsed: {
    hasPromise?: boolean;
    item?: string;
    dueLocal?: string;
    hasTime?: boolean;
    confidence?: number;
  };
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      "[extractInboundPromise] JSON parse failed. Raw:",
      rawContent,
      err,
    );
    return null;
  }

  if (!parsed.hasPromise) return null;

  const item = (parsed.item ?? "").trim().slice(0, 300);
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (!item || confidence < MIN_CONFIDENCE) return null;

  // Normalize the model's local wall-clock date to a strict, zero-padded string
  // before converting to a UTC instant. Tolerates non-padded month/day/hour
  // (e.g. "2026-7-8", "...T9:30") and ignores any trailing offset the model
  // added despite instructions, so a valid promise isn't lost to formatting.
  const m = (parsed.dueLocal ?? "")
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss] = m;
  const datePart = `${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const local =
    hh !== undefined
      ? `${datePart}T${hh.padStart(2, "0")}:${mi}:${(ss ?? "00").padStart(2, "0")}`
      : `${datePart}T23:59:59`; // date only -> end of that day in the user's tz

  const dueAt = fromZonedTime(local, tz);
  if (isNaN(dueAt.getTime())) return null;

  // Drop deadlines already past when the mail arrived (mis-parse), or absurdly
  // far out (wrong-year parse).
  const deltaMs = dueAt.getTime() - input.receivedDate.getTime();
  if (deltaMs <= 0) return null;
  if (deltaMs > MAX_HORIZON_DAYS * 86_400_000) return null;

  return { item, dueAt, confidence };
}

// How far before an OUTBOUND deadline ("I owe them") we surface the reminder.
// The user asked for "usually 30 minutes before"; a per-promise delayed job is
// scheduled at due_at - this (see the sent-mail workers).
export const NUDGE_LEAD_MS = 30 * 60 * 1000;

/**
 * Outbound counterpart of {@link isPromiseCandidate}. The mail was SENT by the
 * user, so there is no untrusted sender to screen (no AUTOMATED_FROM gate) — a
 * real "I owe them" promise still needs BOTH a first-person commitment cue and a
 * temporal cue, which the shared regexes already capture.
 */
export function isOutboundPromiseCandidate(input: {
  subject: string;
  body: string;
}): boolean {
  const haystack = `${input.subject}\n${input.body}`.slice(0, 6000);
  return COMMITMENT_CUE.test(haystack) && TEMPORAL_CUE.test(haystack);
}

// A date-only OUTBOUND deadline ("by Friday", "by end of day") carries no clock
// time. Anchor it to the end of the business day rather than midnight: the nudge
// fires ~30 min before, so end-of-business lands the reminder at ~16:30 — while
// there's still a workday left to act — instead of ~23:29. (Inbound is unaffected:
// it keeps its own 23:59:59 sentinel and its sweep fires AFTER due, so it can give
// the promiser the whole day before nagging.)
const OUTBOUND_END_OF_BUSINESS_HOUR = 17; // 5pm local, in the user's timezone

// Shared local-wall-clock → UTC normalization for OUTBOUND promises, tolerant of
// non-padded month/day/hour and any stray offset the model added. Anchors "date
// only" to end of the business day (above). Returns null on an unparseable, past,
// or absurdly-far-out (wrong-year) result — including a same-day date-only promise
// created after business hours, where a "before end of business" nudge is moot.
function resolveDueAt(
  dueLocal: string,
  tz: string,
  anchorMs: number,
): Date | null {
  const m = (dueLocal ?? "")
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss] = m;
  const datePart = `${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const local =
    hh !== undefined
      ? `${datePart}T${hh.padStart(2, "0")}:${mi}:${(ss ?? "00").padStart(2, "0")}`
      : `${datePart}T${String(OUTBOUND_END_OF_BUSINESS_HOUR).padStart(2, "0")}:00:00`;

  const dueAt = fromZonedTime(local, tz);
  if (isNaN(dueAt.getTime())) return null;
  const deltaMs = dueAt.getTime() - anchorMs;
  if (deltaMs <= 0) return null;
  if (deltaMs > MAX_HORIZON_DAYS * 86_400_000) return null;
  return dueAt;
}

/**
 * Extraction for OUTBOUND promises ("I owe them"): a commitment the user made in
 * an email they SENT to deliver something for the recipient by a deadline.
 * Mirrors {@link extractInboundPromise} with an inverted prompt; the model turns
 * natural language into a local wall-clock date, code turns that into a UTC
 * instant against the user's timezone.
 */
export async function extractOutboundPromise(input: {
  subject: string;
  body: string;
  toEmail: string;
  sentDate: Date;
  userTimezone: string;
}): Promise<ExtractedPromise | null> {
  const tz = input.userTimezone || "UTC";
  // Anchor relative dates ("tomorrow", "Friday") on when the mail was sent,
  // expressed in the user's own timezone.
  const sentLabel = formatInTimeZone(
    input.sentDate,
    tz,
    "EEEE, MMMM d, yyyy 'at' HH:mm",
  );

  const systemMessage =
    "You extract delivery commitments the SENDER made in an email they SENT. Output only the requested JSON.";

  const userMessage = `The user SENT the email below to a recipient. Extract a commitment the SENDER (the user — "I"/"we") made to send, deliver, share, or do something FOR the recipient by a specific deadline ("I owe them" promises).

Only count a promise where the SENDER is the one who will deliver. Do NOT count:
- things the RECIPIENT was asked to do
- vague intentions with no deadline ("I'll be in touch sometime")
- questions or requests aimed at the recipient
- pleasantries or acknowledgements with no concrete deliverable

Resolve relative dates against the sent time: ${sentLabel} (timezone ${tz}).
- Return "dueLocal" as a local wall-clock time in that timezone, format "YYYY-MM-DD" (date only) or "YYYY-MM-DDTHH:mm" (with an explicit clock time). Do NOT include a timezone offset.
- If only a day is given (e.g. "by Friday", "the 18th"), return date only and set hasTime=false.
- "item" is a short noun phrase for what the sender owes (e.g. "the design deck", "the signed contract").
- confidence 0-1: how sure you are this is a real dated commitment by the sender.
- If there is no such promise, set hasPromise=false and leave other fields empty.

To: ${input.toEmail}
Subject: ${input.subject}

Body:
${input.body.slice(0, 6000)}`;

  let rawContent = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano",
      max_completion_tokens: 400,
      reasoning_effort: "low",
      seed: 42,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "OutboundPromise",
          strict: true,
          schema: {
            type: "object",
            properties: {
              hasPromise: {
                type: "boolean",
                description:
                  "True only if the sender committed to deliver something for the recipient by a deadline.",
              },
              item: {
                type: "string",
                description:
                  "Short noun phrase for what the sender owes. Empty when hasPromise is false.",
              },
              dueLocal: {
                type: "string",
                description:
                  "Local wall-clock due time, 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm', no timezone offset. Empty when hasPromise is false.",
              },
              hasTime: {
                type: "boolean",
                description: "True if an explicit clock time was stated.",
              },
              confidence: {
                type: "number",
                description: "0-1 confidence this is a real dated commitment.",
              },
            },
            required: ["hasPromise", "item", "dueLocal", "hasTime", "confidence"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    });
    rawContent = completion.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("[extractOutboundPromise] OpenAI call failed:", err);
    return null;
  }

  if (!rawContent) return null;

  let parsed: {
    hasPromise?: boolean;
    item?: string;
    dueLocal?: string;
    hasTime?: boolean;
    confidence?: number;
  };
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error(
      "[extractOutboundPromise] JSON parse failed. Raw:",
      rawContent,
      err,
    );
    return null;
  }

  if (!parsed.hasPromise) return null;

  const item = (parsed.item ?? "").trim().slice(0, 300);
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (!item || confidence < MIN_CONFIDENCE) return null;

  const dueAt = resolveDueAt(parsed.dueLocal ?? "", tz, input.sentDate.getTime());
  if (!dueAt) return null;

  return { item, dueAt, confidence };
}

/**
 * Draft body for an OUTBOUND promise coming due: the email that DELIVERS what the
 * user committed to send. Framed as "here's the thing you owed", so the user just
 * reviews (and attaches, if it's a file) and hits send.
 */
export async function generateOutboundPromiseDraft(request: {
  subject: string;
  item: string;
  to: string;
  dueLabel: string;
}): Promise<string> {
  const prompt = `You previously told the recipient you would send or deliver something by a deadline that is almost here, and you're about to follow through. Draft the email that delivers it: a short, friendly message (2-4 lines) that hands over the promised item or clearly says it's attached/enclosed. Keep it warm and natural. If the item is a file or document you can't actually produce, write it so the user only has to attach it and send.

What you owe: ${request.item}
Original subject: ${request.subject}
Deadline: ${request.dueLabel}

Write only the email body — no subject line, greeting, or sign-off. Just 2-4 natural lines.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You write short, friendly, professional emails that deliver on a commitment. Output only the message body — no subject, greeting, or sign-off.",
      },
      { role: "user", content: prompt },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 500,
    seed: 42,
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Nudge body for an overdue inbound promise. Mirrors generateFollowUpMessage
 * (lib/sent-followup.ts) but framed as "you said you'd send X, and it's overdue"
 * rather than "I haven't heard back".
 */
export async function generatePromiseNudge(request: {
  subject: string;
  item: string;
  to: string;
  dueLabel: string;
}): Promise<string> {
  const prompt = `The person below committed to send or deliver something to the reader by a deadline that has now passed, and it hasn't arrived. Write a short, friendly nudge (2-3 lines) checking in on it. Keep it warm and polite, not pushy or accusatory. Reference what they owed and that the date has passed.

They owe: ${request.item}
Original subject: ${request.subject}
Deadline (now passed): ${request.dueLabel}

Write only the follow-up message body — no subject line, greeting, or sign-off. Just 2-3 natural lines.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You write short, friendly, professional nudges for overdue commitments. Output only the message body — no subject, greeting, or sign-off.",
      },
      { role: "user", content: prompt },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 500,
    seed: 42,
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
