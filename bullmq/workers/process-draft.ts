import { Job } from "bullmq";
import OpenAI from "openai";
import { useGetUserDraftPreference, incrementDraftCount } from "@/lib/supabase";
import {
  createGmailDraft,
  getGmailMessageBody,
  searchGmail,
  getAttachment,
  downloadAttachment,
  type DraftAttachment,
} from "@/lib/gmail";
import { buildContextAndDraft } from "@/context-engine/pipeline";
import { IncomingEmail } from "@/context-engine/types";
import { clerkClient } from "@clerk/nextjs/server";
import { getDraftContext } from "@/lib/draft";
import {
  createOutlookDraft,
  getOutlookMessageBody,
  searchOutlookAttachmentsByContact,
  searchOutlookAttachmentsByKeyword,
  listOutlookAttachments,
  downloadOutlookAttachment,
} from "@/lib/outlook";
import { sendDraftNotification } from "@/lib/telegram";
import { getUserTier, getTierLimits } from "@/lib/tier-guard";

// ── Attachment auto-resolution ──────────────────────────────────────────────
// When an incoming email asks the user to (re)send a file, find the best match
// from prior mail with that contact and attach it to the draft. Best-effort:
// any failure returns [] and the draft goes out as plain text.

const attachmentPickerAI = new OpenAI({
  baseURL: process.env.AZURE_ENDPOINT!,
  apiKey: process.env.AZURE_API_KEY!,
});

// Attachment size ceilings, kept modest to respect the worker's memory budget
// on the target VPS. Gmail drafts go out via media upload (35 MB API limit);
// Outlook uses a single POST (<3 MB) or a chunked upload session (>=3 MB).
const GMAIL_MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const OUTLOOK_MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_CANDIDATES = 25;

interface AttachmentCandidate {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  from: string;
  date: string;
  /** Subject of the email that carried this file — often more descriptive than the filename. */
  subject: string;
}

/**
 * Ask a small model which candidate file best matches the request. Returns -1
 * when nothing matches OR the best match is only low-confidence — in both cases
 * the caller attaches nothing and the draft goes out as plain text.
 */
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

    const completion = await attachmentPickerAI.chat.completions.create({
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
                  "0-based index of the single best-matching file, or -1 if none clearly match the request.",
              },
              confidence: {
                type: "string",
                enum: ["high", "low"],
                description:
                  "'high' only when the chosen file clearly matches the request; 'low' when it is a guess or nothing really fits.",
              },
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
            "You select which previously-shared file best matches what an email sender is asking to be sent. The candidate files have already been narrowed to the specific contact or company the request refers to, so a generic or time-based request usually maps to one of them. Judge relevance using BOTH the filename and the subject of the email that carried each file (the subject is often more descriptive than the filename). Return the 0-based index of the single best match, or -1 if none genuinely fit. When several files fit, prefer the most recent. Set confidence: 'high' when the chosen file clearly satisfies the request — this INCLUDES generic or time-based requests such as 'the latest file', 'send me the file', or 'that document', where the most recent candidate is the intended one. Use 'low' only when none of the candidates genuinely fit the request, so the system abstains instead of attaching the wrong file.",
        },
        {
          role: "user",
          content: `The sender is asking for: "${query}"\n\nAvailable files:\n${list}\n\nReturn JSON {"index": n, "confidence": "high"|"low"}.`,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) return -1;
    const parsed = JSON.parse(raw) as { index?: number; confidence?: string };
    const idx = typeof parsed.index === "number" ? parsed.index : -1;
    if (idx < 0 || idx >= candidates.length) return -1;
    // Only attach on a confident match. A low-confidence guess abstains so we
    // never staple the wrong file — the draft still goes out as plain text.
    if (parsed.confidence !== "high") {
      console.log("[resolveAttachments] low-confidence match, not attaching", {
        query,
        filename: candidates[idx]?.filename,
      });
      return -1;
    }
    return idx;
  } catch (err) {
    console.error("[resolveAttachments] pick failed", err);
    return -1;
  }
}

// Words that carry no signal for locating a file. Stripping them from the
// request descriptor leaves the brand/topic/file-type keywords worth searching.
const ATTACHMENT_QUERY_STOPWORDS = new Set([
  "the", "a", "an", "latest", "recent", "last", "most", "file", "files",
  "document", "documents", "doc", "docs", "attachment", "attachments",
  "attached", "please", "send", "resend", "share", "forward", "again", "copy",
  "me", "us", "from", "of", "that", "this", "it", "one", "week", "weeks",
  "day", "days", "yesterday", "earlier", "over", "you", "your", "sent",
  "kindly", "could", "can", "would", "pls", "and", "for", "with",
]);

/** Pull descriptive keywords (brand / topic / file-type) out of the request text. */
function extractAttachmentKeywords(...texts: string[]): string[] {
  return Array.from(
    new Set(
      texts
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !ATTACHMENT_QUERY_STOPWORDS.has(w)),
    ),
  ).slice(0, 6);
}

/** Index of the most recently dated candidate; falls back to the first. */
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

/** Run a Gmail search and collect the in-budget attachments from each hit. */
async function gatherGmailCandidates(
  userId: string,
  query: string,
  excludeMessageId: string,
  maxBytes: number,
): Promise<AttachmentCandidate[]> {
  const candidates: AttachmentCandidate[] = [];
  const search = await searchGmail(userId, query, 20);
  for (const msg of search.data) {
    if (msg.id === excludeMessageId) continue;
    if (candidates.length >= MAX_ATTACHMENT_CANDIDATES) break;
    const files = await getAttachment(userId, msg.id);
    for (const f of files) {
      if (candidates.length >= MAX_ATTACHMENT_CANDIDATES) break;
      if (f.size > 0 && f.size <= maxBytes) {
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
  }
  return candidates;
}

/** Collect the in-budget attachments from a set of Outlook message headers. */
async function gatherOutlookCandidates(
  userId: string,
  msgs: { messageId: string; from: string; date: string; subject: string }[],
  excludeMessageId: string,
  maxBytes: number,
): Promise<AttachmentCandidate[]> {
  const candidates: AttachmentCandidate[] = [];
  for (const m of msgs) {
    if (m.messageId === excludeMessageId) continue;
    if (candidates.length >= MAX_ATTACHMENT_CANDIDATES) break;
    const files = await listOutlookAttachments(userId, m.messageId);
    for (const f of files) {
      if (candidates.length >= MAX_ATTACHMENT_CANDIDATES) break;
      if (f.size > 0 && f.size <= maxBytes) {
        candidates.push({
          messageId: f.messageId,
          attachmentId: f.attachmentId,
          filename: f.filename,
          mimeType: f.mimeType,
          size: f.size,
          from: m.from,
          date: m.date,
          subject: m.subject ?? "",
        });
      }
    }
  }
  return candidates;
}

/**
 * Find the file the sender asked for and return it ready to attach; [] when
 * nothing suitable is found. Two passes:
 *   1. search the named contact/company (or, absent one, the sender) for
 *      attachments and let the model pick the best match;
 *   2. if that finds no usable match, fall back to a free-text search built
 *      from the request keywords — this catches files whose sender name/address
 *      doesn't literally contain the brand the request refers to.
 */
async function resolveAttachments(
  userId: string,
  senderEmail: string,
  attachmentQuery: string,
  attachmentFromContact: string,
  isGmail: boolean,
  excludeMessageId: string,
): Promise<DraftAttachment[]> {
  // Search the named third party's thread when the request points to someone
  // other than the sender ("the file Yash sent you"); otherwise the sender's.
  const searchContact = (attachmentFromContact || senderEmail || "").trim();
  if (!searchContact) return [];
  // The descriptor handed to the picker. When the request was too generic for
  // the model to name a file, fall back to a temporal default so the picker
  // still resolves to the most recent file from the contact.
  const effectiveQuery =
    attachmentQuery.trim() || "the most recent file the sender is asking me to resend";
  console.log("[resolveAttachments] start", {
    attachmentQuery,
    effectiveQuery,
    attachmentFromContact,
    senderEmail,
    searchContact,
    searchedSource: attachmentFromContact ? "named-contact" : "sender-fallback",
    isGmail,
  });
  const maxBytes = isGmail ? GMAIL_MAX_ATTACH_BYTES : OUTLOOK_MAX_ATTACH_BYTES;

  // ── Pass 1: search the contact / company the request points at ────────────
  let candidates: AttachmentCandidate[] = [];
  try {
    if (isGmail) {
      // Quote the value so multi-word names ("Yash Kumar") and emails both work.
      const gmailContact = searchContact
        .replace(/["()\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (gmailContact) {
        candidates = await gatherGmailCandidates(
          userId,
          `has:attachment (from:"${gmailContact}" OR to:"${gmailContact}")`,
          excludeMessageId,
          maxBytes,
        );
      }
    } else {
      const msgs = await searchOutlookAttachmentsByContact(userId, searchContact, 40);
      candidates = await gatherOutlookCandidates(userId, msgs, excludeMessageId, maxBytes);
    }
  } catch (err) {
    console.error("[resolveAttachments] contact search failed", err);
    candidates = [];
  }
  console.log("[resolveAttachments] contact candidates", {
    searchContact,
    count: candidates.length,
    filenames: candidates.map((c) => c.filename),
  });

  // How specific was the request? Strip the source/contact tokens; if nothing
  // descriptive remains ("send me the file", "the file I sent you this week",
  // "the latest file from Upscale"), it is a GENERIC ask — attach the most
  // recent candidate deterministically rather than asking the picker, which
  // abstains on vague requests. Drafts are reviewed before sending, so a
  // best-effort attach beats an empty draft.
  const sourceTokens = new Set(extractAttachmentKeywords(attachmentFromContact));
  const descriptorKeywords = extractAttachmentKeywords(attachmentQuery).filter(
    (k) => !sourceTokens.has(k),
  );
  const isGenericRequest = descriptorKeywords.length === 0;

  const chooseFrom = async (cands: AttachmentCandidate[]): Promise<number> => {
    if (cands.length === 0) return -1;
    if (isGenericRequest) {
      const i = mostRecentIndex(cands);
      console.log("[resolveAttachments] generic request → most recent", {
        filename: cands[i]?.filename,
      });
      return i;
    }
    const i = await pickBestAttachment(effectiveQuery, cands);
    // Specific request the model couldn't confidently match, but only one
    // distinct file exists — attach it; there is no other file it could mean.
    if (i < 0 && new Set(cands.map((c) => c.filename.toLowerCase())).size === 1) {
      const j = mostRecentIndex(cands);
      console.log("[resolveAttachments] single distinct file → attaching", {
        filename: cands[j]?.filename,
      });
      return j;
    }
    return i;
  };

  let pool = candidates;
  let idx = await chooseFrom(pool);

  // ── Pass 2: keyword fallback when the contact search yielded no match ──────
  if (idx < 0) {
    const keywords = extractAttachmentKeywords(attachmentQuery, attachmentFromContact);
    if (keywords.length > 0) {
      console.log("[resolveAttachments] keyword fallback", { keywords });
      let fallback: AttachmentCandidate[] = [];
      try {
        if (isGmail) {
          const orExpr = keywords.map((k) => `"${k}"`).join(" OR ");
          fallback = await gatherGmailCandidates(
            userId,
            `has:attachment (${orExpr})`,
            excludeMessageId,
            maxBytes,
          );
        } else {
          const msgs = await searchOutlookAttachmentsByKeyword(userId, keywords, 40);
          fallback = await gatherOutlookCandidates(userId, msgs, excludeMessageId, maxBytes);
        }
      } catch (err) {
        console.error("[resolveAttachments] keyword fallback search failed", err);
        fallback = [];
      }
      console.log("[resolveAttachments] fallback candidates", {
        count: fallback.length,
        filenames: fallback.map((c) => c.filename),
      });
      if (fallback.length > 0) {
        const fbIdx = await chooseFrom(fallback);
        if (fbIdx >= 0) {
          pool = fallback;
          idx = fbIdx;
        }
      }
    }
  }

  if (idx < 0) return [];
  const chosen = pool[idx];
  console.log("[resolveAttachments] attaching", {
    filename: chosen.filename,
    from: chosen.from,
    subject: chosen.subject,
  });

  try {
    const base64 = isGmail
      ? await downloadAttachment(userId, chosen.messageId, chosen.attachmentId)
      : await downloadOutlookAttachment(userId, chosen.messageId, chosen.attachmentId);
    if (!base64) return [];
    return [{ filename: chosen.filename, mimeType: chosen.mimeType, base64 }];
  } catch (err) {
    console.error("[resolveAttachments] download failed", err);
    return [];
  }
}

interface ProcessDraftData {
  userName: string;
  userId: string;
  emailData: {
    userId: string;
    subject: string;
    from: string;
    bodySnippet: string;
    threadId: string;
    receivedAt: string;
  };
  senderName: string;
  senderEmail: string;
  messageId: string;
  tokenData: string;
  is_gmail: boolean;
}

export async function processDraft(job: Job<ProcessDraftData>) {
  const {
    userName,
    userId,
    emailData,
    senderName,
    senderEmail,
    messageId,
    tokenData,
    is_gmail,
  } = job.data;

  const tier = await getUserTier(userId);

  const draftPreference = await useGetUserDraftPreference(userId);

  if (!draftPreference.enabled) {
    return { status: "skipped", reason: "Drafts disabled" };
  }

  if (tier !== "MAX") {
    const limits = await getTierLimits(userId);
    if (limits.maxAiDraftsPerMonth !== Infinity) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const needsReset =
        !draftPreference.draftCountResetAt ||
        new Date(draftPreference.draftCountResetAt) < startOfMonth;
      const currentCount = needsReset ? 0 : draftPreference.draftCount;

      if (currentCount >= limits.maxAiDraftsPerMonth) {
        return {
          status: "skipped",
          reason: `AI draft limit reached (${limits.maxAiDraftsPerMonth}/month) for ${tier} tier`,
        };
      }
    }
  }

  const { draftPrompt, fontColor, fontSize, signature, language } =
    draftPreference;

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const clerkUserFullName = user.fullName;

  let fullEmailBody = "";

  if (is_gmail) {
    try {
      fullEmailBody = await getGmailMessageBody(userId, messageId);
    } catch (error) {
      console.error(
        "Failed to fetch full Gmail body, using snippet fallback",
        { userId, messageId, error },
      );
      fullEmailBody = emailData.bodySnippet;
    }
  } else {
    try {
      fullEmailBody = await getOutlookMessageBody(userId, messageId);
    } catch (error) {
      console.error(
        "Failed to fetch full Outlook body, using snippet fallback",
        { userId, messageId, error },
      );
      fullEmailBody = emailData.bodySnippet;
    }
  }

  const incomingEmail: IncomingEmail = {
    userId: userId,
    subject: emailData.subject,
    body: fullEmailBody,
    senderName,
    senderEmail,
    receivedAt: new Date(emailData.receivedAt || Date.now()),
  };

  const response = await getDraftContext({
    user_name: userName,
    user_id: userId,
    subject: emailData.subject,
    sender_email: senderEmail,
    body: fullEmailBody,
    token: tokenData,
    timezone: draftPreference.timezone ?? "UTC",
    is_gmail: is_gmail,
    threadId: emailData.threadId,
  });

  const { draft, needsAttachment, attachmentQuery, attachmentFromContact } = await buildContextAndDraft(
    incomingEmail,
    is_gmail,
    draftPreference.timezone ?? "UTC",
    draftPrompt,
    clerkUserFullName,
    response.retrieved_history,
    response.thread_context,
    response.intent,
    response.keywords,
    response.mentionedDates,
    language,
  );

  let draft_id = "";
  let drafted = false;

  const willDraft = draft.trim() !== "NO_REPLY_NEEDED" && draft.trim().length > 0;

  // If the sender asked for an existing file, try to find and attach it.
  // Best-effort: on any failure the draft is still created without an attachment.
  // Trigger on needsAttachment alone — a generic request ("send me the file I
  // sent you earlier") may leave attachmentQuery thin, but resolveAttachments
  // handles that with a default descriptor and prefers the most recent match.
  let attachments: DraftAttachment[] = [];
  if (willDraft && needsAttachment) {
    try {
      attachments = await resolveAttachments(
        userId,
        senderEmail,
        attachmentQuery,
        attachmentFromContact,
        is_gmail,
        messageId,
      );
    } catch (err) {
      console.error("[processDraft] attachment resolution error", { userId, messageId, err });
    }
  }

  if (willDraft) {
    if (is_gmail) {
      let createdGmailDraft;
      try {
        createdGmailDraft = await createGmailDraft(
          userId,
          emailData.threadId,
          messageId,
          emailData.subject,
          emailData.from,
          draft,
          fontColor,
          fontSize,
          signature,
          attachments,
        );
      } catch (err) {
        // An attachment problem (size, encoding, upload) must never lose the
        // draft — retry once as plain text so the reply is still created.
        if (attachments.length > 0) {
          console.error(
            "[processDraft] Gmail draft with attachment failed; retrying without it",
            { userId, messageId, err },
          );
          createdGmailDraft = await createGmailDraft(
            userId,
            emailData.threadId,
            messageId,
            emailData.subject,
            emailData.from,
            draft,
            fontColor,
            fontSize,
            signature,
            [],
          );
        } else {
          throw err;
        }
      }
      draft_id = createdGmailDraft?.id ?? "";
      drafted = true;
    } else {
      const createdOutlookDraft = await createOutlookDraft(
        userId,
        messageId,
        emailData.subject,
        emailData.from,
        draft,
        fontColor,
        fontSize,
        signature,
        attachments,
      );
      draft_id = createdOutlookDraft?.id ?? "";
      drafted = true;
    }
  }

  if (draft.trim() !== "NO_REPLY_NEEDED" && draft.trim().length > 0) {
    if (is_gmail) {
      await sendDraftNotification(
        userId,
        emailData.from,
        emailData.subject,
        draft,
        draft_id,
      );
    }
  }

  if (drafted) {
    await incrementDraftCount(userId);
  }

  return { status: "success", drafted, draft_id };
}

export default processDraft;
