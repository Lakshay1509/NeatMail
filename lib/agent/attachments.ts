// Smart attachment resolution — lifted from bullmq/workers/process-draft.ts and
// generalized over MailProvider. This is the one piece of the old chat worth
// keeping: it finds the file a user means from a vague request ("send me the
// invoice from Acme", "the latest file I got") using a confidence-gated AI
// picker with a most-recent / keyword fallback, and abstains rather than attach
// the wrong file.

import OpenAI from "openai";
import type { AttachmentCandidate, MailProvider } from "./types";

const picker = new OpenAI({
  baseURL: process.env.AZURE_ENDPOINT!,
  apiKey: process.env.AZURE_API_KEY!,
});

// Keep in-memory attachment blobs modest for the 768 MB runtime.
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_CANDIDATES = 25;

export interface ResolvedAttachment {
  filename: string;
  mimeType: string;
  base64: string;
  from: string;
  subject: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "latest", "recent", "last", "most", "file", "files",
  "document", "documents", "doc", "docs", "attachment", "attachments",
  "attached", "please", "send", "resend", "share", "forward", "again", "copy",
  "me", "us", "from", "of", "that", "this", "it", "one", "week", "weeks",
  "day", "days", "yesterday", "earlier", "over", "you", "your", "sent",
  "kindly", "could", "can", "would", "pls", "and", "for", "with",
]);

function extractKeywords(...texts: string[]): string[] {
  return Array.from(
    new Set(
      texts
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ).slice(0, 6);
}

function mostRecentIndex(candidates: AttachmentCandidate[]): number {
  let best = 0;
  let bestTime = -Infinity;
  candidates.forEach((c, i) => {
    const t = Date.parse(c.date);
    const time = Number.isNaN(t) ? -Infinity : t;
    if (time > bestTime) {
      bestTime = time;
      best = i;
    }
  });
  return best;
}

/** Ask a small model which candidate best matches; -1 if none / low confidence. */
async function pickBestAttachment(
  query: string,
  candidates: AttachmentCandidate[],
): Promise<number> {
  if (candidates.length === 0) return -1;
  try {
    const list = candidates
      .map(
        (c, i) =>
          `${i}. "${c.filename}" (email subject: ${c.subject ? `"${c.subject}"` : "none"}) — from ${c.from || "unknown"} on ${c.date || "unknown"}, ${Math.round(c.size / 1024)} KB`,
      )
      .join("\n");

    const completion = await picker.chat.completions.create({
      model: "gpt-5-nano",
      reasoning_effort: "low",
      max_completion_tokens: 200,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "AttachmentPick",
          strict: true,
          schema: {
            type: "object",
            properties: {
              index: {
                type: "integer",
                description:
                  "0-based index of the single best-matching file, or -1 if none clearly match.",
              },
              confidence: { type: "string", enum: ["high", "low"] },
            },
            required: ["index", "confidence"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You select which previously-shared file best matches what the user is asking for. Judge relevance using BOTH the filename and the subject of the email that carried each file. Return the 0-based index of the single best match, or -1 if none genuinely fit. When several fit, prefer the most recent. Set confidence 'high' when the chosen file clearly satisfies the request — INCLUDING generic/time-based asks like 'the latest file' where the most recent candidate is intended. Use 'low' only when nothing genuinely fits, so the system abstains rather than attach the wrong file.",
        },
        {
          role: "user",
          content: `The user is asking for: "${query}"\n\nAvailable files:\n${list}\n\nReturn JSON {"index": n, "confidence": "high"|"low"}.`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) return -1;
    const parsed = JSON.parse(raw) as { index?: number; confidence?: string };
    const idx = typeof parsed.index === "number" ? parsed.index : -1;
    if (idx < 0 || idx >= candidates.length) return -1;
    if (parsed.confidence !== "high") return -1;
    return idx;
  } catch (err) {
    console.error("[attachments] pick failed", err);
    return -1;
  }
}

function budget(cands: AttachmentCandidate[]): AttachmentCandidate[] {
  return cands
    .filter((c) => c.size > 0 && c.size <= ATTACHMENT_MAX_BYTES)
    .slice(0, MAX_CANDIDATES);
}

/**
 * Resolve the file the user asked for, ready to download. Two passes:
 *   1. search the named contact/company (when one is given) and pick;
 *   2. keyword fallback across the mailbox.
 * Returns null when nothing suitable is found (caller tells the user).
 */
export async function resolveAttachment(
  provider: MailProvider,
  opts: { query: string; fromContact?: string; excludeMessageId?: string },
): Promise<ResolvedAttachment | null> {
  const query = opts.query.trim();
  const fromContact = (opts.fromContact ?? "").trim();
  const exclude = opts.excludeMessageId ?? "";
  const effectiveQuery =
    query || "the most recent file the user is asking for";

  // Is the request generic (no descriptive keyword beyond the contact)?
  const sourceTokens = new Set(extractKeywords(fromContact));
  const descriptorKeywords = extractKeywords(query).filter(
    (k) => !sourceTokens.has(k),
  );
  const isGeneric = descriptorKeywords.length === 0;

  const choose = async (cands: AttachmentCandidate[]): Promise<number> => {
    if (cands.length === 0) return -1;
    if (isGeneric) return mostRecentIndex(cands);
    const i = await pickBestAttachment(effectiveQuery, cands);
    if (
      i < 0 &&
      new Set(cands.map((c) => c.filename.toLowerCase())).size === 1
    ) {
      return mostRecentIndex(cands);
    }
    return i;
  };

  const notExcluded = (c: AttachmentCandidate) => c.messageId !== exclude;

  // ── Pass 1: contact / company search ──
  let pool: AttachmentCandidate[] = [];
  let idx = -1;
  if (fromContact) {
    try {
      pool = budget(
        (await provider.gatherAttachmentCandidatesByContact(fromContact, 40)).filter(
          notExcluded,
        ),
      );
      idx = await choose(pool);
    } catch (err) {
      console.error("[attachments] contact pass failed", err);
    }
  }

  // ── Pass 2: keyword fallback ──
  if (idx < 0) {
    const keywords = extractKeywords(query, fromContact);
    if (keywords.length > 0) {
      try {
        const fallback = budget(
          (await provider.gatherAttachmentCandidatesByKeyword(keywords, 40)).filter(
            notExcluded,
          ),
        );
        const fbIdx = await choose(fallback);
        if (fbIdx >= 0) {
          pool = fallback;
          idx = fbIdx;
        }
      } catch (err) {
        console.error("[attachments] keyword pass failed", err);
      }
    }
  }

  if (idx < 0) return null;
  const chosen = pool[idx];

  try {
    const base64 = await provider.downloadAttachment(
      chosen.messageId,
      chosen.attachmentId,
    );
    if (!base64) return null;
    return {
      filename: chosen.filename,
      mimeType: chosen.mimeType,
      base64,
      from: chosen.from,
      subject: chosen.subject,
    };
  } catch (err) {
    console.error("[attachments] download failed", err);
    return null;
  }
}
