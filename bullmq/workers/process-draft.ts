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
            "You select which previously-shared file best matches what an email sender is asking to be sent. Judge relevance using BOTH the filename and the subject of the email that carried each file (the subject is often more descriptive than the filename). Return the 0-based index of the single best match, or -1 if none clearly match. Also return confidence: 'high' only when you are sure the file matches the request; otherwise 'low'. When several match, prefer the most recent.",
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

/**
 * Gather attachment candidates from the conversation with `senderEmail` (both
 * directions), let the model pick the best match for `attachmentQuery`, download
 * it, and return it ready to attach. Returns [] when nothing suitable is found.
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
  const maxBytes = isGmail ? GMAIL_MAX_ATTACH_BYTES : OUTLOOK_MAX_ATTACH_BYTES;
  const candidates: AttachmentCandidate[] = [];

  try {
    if (isGmail) {
      // Quote the value so multi-word names ("Yash Kumar") and emails both work.
      const gmailContact = searchContact
        .replace(/["()\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!gmailContact) return [];
      const search = await searchGmail(
        userId,
        `has:attachment (from:"${gmailContact}" OR to:"${gmailContact}")`,
        20,
      );
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
    } else {
      const msgs = await searchOutlookAttachmentsByContact(userId, searchContact, 40);
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
    }
  } catch (err) {
    console.error("[resolveAttachments] candidate gathering failed", err);
    return [];
  }

  if (candidates.length === 0) return [];

  const idx = await pickBestAttachment(attachmentQuery, candidates);
  if (idx < 0) return [];
  const chosen = candidates[idx];

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
  let attachments: DraftAttachment[] = [];
  if (willDraft && needsAttachment && attachmentQuery) {
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
