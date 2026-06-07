// src/context-engine/pipeline.ts

import { convert } from "html-to-text";
import { ContextAssembler }        from "./assembler"
import { GoogleCalendarProvider } from "./providers/google-calender"
import { OutlookCalendarProvider } from "./providers/outlook-calender"
import { SlackProvider }          from "./providers/slack"
import { HubSpotProvider }       from "./providers/hubspot"
import { NotionProvider }       from "./providers/notion"
import { GitHubProvider }        from "./providers/github"

import { EmailEntities, EmailIntent, IncomingEmail } from "./types"
import { db } from "@/lib/prisma"
import { decrypt } from "@/lib/encode"

// ── Register all providers here — this is the ONLY file
//    you touch when adding a new integration ──────────────

import OpenAI from "openai";
import { getUserConnectedProviders } from "@/lib/clerk"

const endpoint = process.env.AZURE_ENDPOINT!;
const deploymentName = "gpt-5-mini";
const apiKey = process.env.AZURE_API_KEY!;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});

// ── Prompt hygiene & token budget constants ──────────────

const MAX_HISTORY_ITEMS        = 8;
const MAX_THREAD_ITEMS         = 8;
const MAX_BODY_CHARS           = 4000;
const MAX_HISTORY_BODY_CHARS   = 600;
const MAX_THREAD_BODY_CHARS    = 800;
const MAX_PROVIDER_SUMMARY_CHARS = 800;
  const MAX_OUTPUT_TOKENS        = 2048;

// ── Helpers ──────────────────────────────────────────────

export function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  try {
    return convert(html, { wordwrap: false }).trim();
  } catch {
    return html.replace(/<[^>]*>?/gm, "").trim();
  }
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function formatEmailItem(
  item: Record<string, unknown>,
  maxBodyChars: number
): string {
  const from = typeof item.from === "string" ? item.from : "Unknown sender";
  const date = typeof item.date === "string" ? item.date : "";
  let body = typeof item.body === "string" ? item.body : "";

  if (!body.trim()) return ""; // skip empty items

  body = normalizeLineEndings(body);
  body = stripHtml(body);
  if (body.length > maxBodyChars) {
    body = body.slice(0, maxBodyChars).trimEnd() + " ...";
  }

  const header = [from, date].filter(Boolean).join(" | ");
  return header ? `${header}\n${body}` : body;
}

export function formatContextList(
  items: Record<string, unknown>[],
  maxItems: number,
  maxBodyChars: number
): string {
  const formatted = items
    .slice(0, maxItems)
    .map((item) => formatEmailItem(item, maxBodyChars))
    .filter(Boolean);

  if (formatted.length === 0) return "None";
  return formatted.join("\n\n---\n\n");
}

export function getIntentGuidance(intent: EmailIntent): string {
  switch (intent) {
    case "scheduling_request":
      return "This is a SCHEDULING REQUEST. Propose specific times, reference calendar availability from the connected app context, or ask clarifying questions about timing.";
    case "meeting_confirmation":
      return "This is a MEETING CONFIRMATION. Confirm attendance, suggest an agenda if missing, or request a reschedule with alternatives.";
    case "task_assignment":
      return "This is a TASK ASSIGNMENT. Take ownership immediately. Confirm the task, restate the deadline if one is given, and outline the concrete next steps you will take. Do NOT ask for prerequisites or data you would naturally gather during the work. Only ask for clarification if the scope is truly ambiguous.";
    case "status_update":
      return "This is a STATUS UPDATE REQUEST. Provide a brief, factual update. If information is missing, state what you need instead of guessing.";
    case "question":
      return "This is a QUESTION. Answer directly and concisely. If you don't have the answer, say so and offer a follow-up timeline.";
    case "approval":
      return "This is an APPROVAL REQUEST. State approval or denial clearly. If conditional, specify exact conditions or missing requirements.";
    case "follow_up":
      return "This is a FOLLOW-UP. Reference the previous topic, summarize current status, and propose a clear next step.";
    case "introduction":
      return "This is an INTRODUCTION. Acknowledge the introduction, express interest or availability, and suggest a concrete next step.";
    case "complaint":
      return "This is a COMPLAINT. Acknowledge the issue with empathy, take responsibility where appropriate, and provide a specific resolution or next-step timeline. Do not be dismissive.";
    case "general":
    default:
      return "This is a GENERAL email. Respond naturally and keep it brief. If it's just sharing an attachment, update, or FYI, a 1-sentence acknowledgment is enough. Do not over-engineer the reply.";
  }
}

export function buildStyleInstruction(
  userName: string | null,
  hasHistory: boolean
): string {
  if (!userName || !hasHistory) {
    return `Tone: Write in a professional, neutral tone. Keep sentences concise. Avoid excessive formality, filler phrases (e.g., "I hope this email finds you well"), and unnecessary exclamation marks.`;
  }

  return `Tone & Style Mirroring:
Messages marked "${userName}" in the "Previous emails" section are written by the person you are drafting for.
You MUST analyze their writing style and replicate it exactly. Look closely at their patterns across all history and mirror them:

- Sentence length and structure (short/choppy vs. long/flowing)
- Vocabulary level and formality (casual slang vs. polished professional)
- Punctuation habits: do they use em-dashes, semicolons, ellipses? How many exclamation marks?
- Emoji usage: do they use emojis? Which ones? How frequently? Never add emojis they haven't used.
- Expressiveness: are they enthusiastic (multiple exclamations, "haha"), neutral, or restrained?
- Capitalization quirks: do they use ALL CAPS for emphasis? Sentence case only? Lowercase everything?
- Greeting style: "Hey", "Hi", "Dear", first name only, or no greeting at all
- Sign-off style: "Best", "Thanks", "Cheers", "-Name", or no sign-off
- Request style: direct ("Do this") vs. polite hedging ("Would you mind...")
- Do they use abbreviations (lol, tbh, fyi, imo, wrt) or write everything out?

Do NOT invent a generic assistant voice. If their style is blunt, be blunt. If their style is casual with emojis, use emojis the same way. If they write like a laid-back human, write like a laid-back human.`;
}

// ── Main function your webhook calls ───────────────────────

export async function buildContextAndDraft(
  email:    IncomingEmail,
  isGmail: boolean,
  timezone: string,
  draftPrompt: string | null,
  user_name: string | null,
  retrieved_history: Record<string, unknown>[],
  thread_context: Record<string, unknown>[] | null,
  intent:         EmailIntent,
  keywords:       string[],
  mentionedDates: { raw: string; iso: string }[],
  language: string = "english",
): Promise<{ draft: string; contextSummary: string }> {

  const assembler = new ContextAssembler()

  if (isGmail) {
    assembler.register(new GoogleCalendarProvider())
  } else {
    assembler.register(new OutlookCalendarProvider())
  }

  const slackIntegration = await db.slack_integration.findUnique({
    where: { user_id: email.userId },
  })
  if (slackIntegration) {
    const token = await decrypt(slackIntegration.access_token)
    assembler.register(new SlackProvider(token))
  }

  const data = await getUserConnectedProviders(email.userId);

  if (data.includes("hubspot")) {
    assembler.register(new HubSpotProvider())
  }

  if (data.includes("notion")) {
    assembler.register(new NotionProvider())
  }

  if (data.includes("github")) {
    assembler.register(new GitHubProvider())
  }

  const entities: EmailEntities = {
    senderEmail:  email.senderEmail,
    senderName:   email.senderName,
    senderDomain: email.senderEmail.split("@")[1] ?? email.senderEmail,
    keywords,
    mentionedDates,
    intent,
    timezone,
  }

  // 2. Assemble context from all relevant providers in parallel
  const cards = await assembler.assemble(email, entities)

  // 3. Build prompt block from cards
  const contextBlock = cards.length > 0
    ? `## Context from connected apps\n\n${cards.map(c => {
        const summary = c.summary.length > MAX_PROVIDER_SUMMARY_CHARS
          ? c.summary.slice(0, MAX_PROVIDER_SUMMARY_CHARS).trimEnd() + " ..."
          : c.summary;
        return `### ${c.providerName}\n${summary}`;
      }).join("\n\n")}`
    : ""

  const customInstructions = draftPrompt
    ? `\n<custom_instructions>\n${draftPrompt}\n</custom_instructions>`
    : "";
  const userNameInstruction = user_name
    ? `\n<user_identity>\nThe user's name is ${user_name}. Reply on their behalf.\n</user_identity>`
    : "";
  const languageInstruction = language !== "english"
    ? `\n<language>\nWrite the reply in ${language}. All output must be in ${language}.\n</language>`
    : "";

  const historyText = formatContextList(
    retrieved_history,
    MAX_HISTORY_ITEMS,
    MAX_HISTORY_BODY_CHARS
  );
  const threadText = formatContextList(
    thread_context ?? [],
    MAX_THREAD_ITEMS,
    MAX_THREAD_BODY_CHARS
  );
  const cleanBody     = stripHtml(email.body).slice(0, MAX_BODY_CHARS).replace(/\n{3,}/g, "\n\n");
  const cleanSubject  = email.subject.slice(0, 200);
  const datesText     = mentionedDates.length > 0
    ? mentionedDates.map(d => `${d.raw} (${d.iso})`).join(", ")
    : "None";
  const keywordsText  = keywords.length > 0
    ? keywords.slice(0, 20).join(", ")
    : "None";

  const hasHistory = retrieved_history.length > 0;
  const styleInstruction = buildStyleInstruction(user_name, hasHistory);
  const intentGuidance = getIntentGuidance(intent);
  const providerContext = contextBlock || "No additional context from connected apps.";

  const systemMessage = `You are a professional email drafting assistant.
Your task is to analyze the provided email and generate a reply draft.
You must ALWAYS output a single valid JSON object matching the provided schema.
Do not include markdown, explanations, or any text outside the JSON object.

Detection rules — Set noReplyNeeded=true, draft="NO_REPLY_NEEDED" only if email needs no action:
- Newsletters/digests (has "unsubscribe" or "manage preferences")
- Pure receipts: order/payment/shipping confirmations with no action implied
- Informational system summaries ("your report is ready", "weekly digest")

Never set noReplyNeeded if content has: "action required", "failed", "expires", "critical", "warning", "unauthorized", "error"

Sender pattern (noreply@, alerts@) is a weak signal — content decides.

Reply generation rules (only when noReplyNeeded is false):
1. Determine what the sender actually wants: a simple acknowledgment, an action, information, or a decision.
2. SIMPLE ACKNOWLEDGMENTS: If the email just shares an attachment, update, or document for you to review — and does NOT ask for specific actions or a decision — reply with a brief 1-sentence acknowledgment (e.g., "Thanks, I'll take a look"). Do NOT invent review workflows, timelines, meeting proposals, approval notes, or next steps. Just acknowledge receipt. If you're unsure whether the sender wants more than an acknowledgment, default to a short 1-sentence reply.
3. ACTION REQUESTS: Only when the email explicitly asks you to do something (investigate, fix, handle, build) — confirm you'll handle it. If a deadline is given, acknowledge it. Describe concrete next steps ONLY using information from the email. Do NOT fabricate specific steps, deliverables, or meetings the sender didn't ask for. Do NOT offer to "propose a sync" or "schedule a call" unless the sender requested one.
4. INFORMATION REQUESTS: If the email asks for information you genuinely do not have — acknowledge what was asked, share what you know from context if any, and say you'll follow up. Do NOT use bracket placeholders like [DATE NEEDED]. Do NOT invent facts.
5. Do NOT include a subject line, greeting lines like "Dear", or signatures.
6. Output plain text only inside the JSON string value.
7. Respect custom instructions, but NEVER override the structural rules above.
8. Keep it SHORT. Simple acknowledgments/shares: 1-2 sentences max. Questions/updates: 2-3 sentences. Task/complex: 3-5 sentences. Complaints: 4-6 sentences. Never exceed 8 sentences. When in doubt, write fewer sentences.

Tone guidance: write like a real person, not an assistant bot. Be warm, direct, and natural. Match the user's communication style from history. Avoid corporate jargon, filler phrases, and stiff formality unless it matches the user's voice. Do NOT add appreciations ("thanks for pulling this together", "appreciate your work on this") unless the email content genuinely warrants gratitude.

EXAMPLES — follow these patterns exactly:

Example A — Simple share/acknowledgment (MOST COMMON: someone sends a file, update, or doc for review):
Email says: "Here's the breakdown of Milestones in the attached file. Take a look at it."
WRONG draft: "Got the milestone breakdown — thanks. I'll review the attached file now, consolidate any questions or gaps, and send you my feedback and approval notes by EOD today. If anything needs a decision beyond that, I'll flag it clearly and propose a quick 15-minute sync."
CORRECT draft: "Thanks, I'll take a look."

Example B — Missing information:
Email asks: "Can you share what was discussed in last meeting with Alice and when is budget set to approve?"
Available context: No meeting notes, no budget details.
WRONG draft: "I don't have the meeting notes from your discussion with Alice on hand. [MEETING NOTES NEEDED]"
CORRECT draft: "I wasn't in that meeting so I don't have the details. Let me check on the budget timeline and get back to you."

Example C — Partial context available:
Email asks: "Can you share what was discussed in last meeting with Alice and when is budget set to approve?"
Available context: Notion page "Q2 Roadmap" says "Alice will be approving budget by end of the month."
CORRECT draft: "I wasn't in that meeting, but from the Q2 roadmap Alice should be approving budget by end of month. I'll check for meeting notes and circle back."

Example D — Has context from connected apps:
Email asks: "When are we meeting next week?"
Available context: Google Calendar shows "Project Sync" on Tuesday 3pm.
CORRECT draft: "We're scheduled for the Project Sync on Tuesday at 3pm. Let me know if that still works."

Example E — Action explicitly requested with deadline:
Email says: "Can you dig into this and get it resolved before the weekend? We have about 12 users on affected accounts and don't want them hitting access issues on Monday morning."
Available context: Email mentions a 422 error on subscription renewals, a possible plan_id mismatch, and a March rename.
WRONG draft: "do you mean by end of day Friday? I don't have the failing payloads or affected account IDs; please send a sample webhook payload, one affected account ID, and any relevant logs from Siddharth so I can confirm whether the plan_id mismatch is the cause."
CORRECT draft: "On it — I'll pull the webhook logs and cross-check the plan_id mapping from the March rename. Should have a fix shipped before Friday EOD. I'll ping you once it's resolved."

${intentGuidance}

${styleInstruction}

Connected app context: If calendar, Slack, CRM, Notion, or GitHub data is provided in the prompt, use it silently. Do NOT mention that you checked external apps.`;

  const userMessage = `Analyze the following email and produce the JSON output.

<context>
Connected app context:
${providerContext}

Previous emails from this sender (history):
${historyText}

Current email thread (recent messages):
${threadText}

Mentioned dates: ${datesText}
Timezone: ${timezone}
Keywords: ${keywordsText}
</context>

<input_email>
From: ${email.senderName}
Subject: ${cleanSubject}
Body:
${cleanBody}
</input_email>${customInstructions}${userNameInstruction}${languageInstruction}

OUTPUT FORMAT:
Return ONLY a JSON object strictly matching this schema:
{
  "noReplyNeeded": boolean,
  "draft": string
}`;

  // 4. Generate draft
  const completion = await openai.chat.completions.create({
    model: deploymentName,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "DraftOutput",
        strict: true,
        schema: {
          type: "object",
          properties: {
            noReplyNeeded: {
              type: "boolean",
              description:
                "True if the email is automated, a newsletter, or a system message that needs no reply.",
            },
            draft: {
              type: "string",
              description:
                "The reply draft text. If noReplyNeeded is true, this must be exactly 'NO_REPLY_NEEDED'.",
            },
          },
          required: ["noReplyNeeded", "draft"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
  });

  const finishReason = completion.choices?.[0]?.finish_reason ?? "unknown";
  const rawContent = completion.choices?.[0]?.message?.content ?? "";

  if (!rawContent) {
    console.error(
      "[buildContextAndDraft] Empty model response",
      `finish_reason=${finishReason}`
    );
    return { draft: "", contextSummary: contextBlock };
  }

  // Parse response to extract draft
  let draft = "";
  try {
    const parsed = JSON.parse(rawContent) as {
      noReplyNeeded?: boolean;
      draft?: string;
    };
    if (
      typeof parsed.noReplyNeeded === "boolean" &&
      typeof parsed.draft === "string"
    ) {
      draft = parsed.draft.trim();
    } else {
      console.error(
        "[buildContextAndDraft] Schema validation failed. Raw:",
        rawContent
      );
    }
  } catch (err) {
    console.error(
      "[buildContextAndDraft] JSON parse failed. Raw:",
      rawContent,
      `finish_reason=${finishReason}`,
      "Error:",
      err
    );
  }

  return {
    draft,
    contextSummary: contextBlock,
  }
}
