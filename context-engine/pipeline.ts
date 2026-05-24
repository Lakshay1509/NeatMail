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
  const MAX_OUTPUT_TOKENS        = 600;

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
      return "This is a TASK ASSIGNMENT. Acknowledge the task, confirm deadlines, and ask for clarification on scope if ambiguous.";
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
      return "This is a GENERAL email. Respond naturally, address the main point, and keep it concise.";
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
You MUST analyze their writing style and replicate it exactly:
- Sentence length and structure
- Vocabulary level and formality
- Punctuation habits (e.g., do they use em-dashes, semicolons, exclamation marks?)
- Whether they use sign-offs, first names, or no greeting at all
- How they handle requests (direct vs. polite hedging)

Do NOT invent a generic assistant voice. If their style is blunt, be blunt. If their style is warm and casual, be warm and casual.`;
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

Detection rules — set noReplyNeeded to true and draft to exactly "NO_REPLY_NEEDED":
- Automated emails: from addresses containing "noreply", "do-not-reply", "notification", "alert", "receipt", "invoice"
- Newsletters: containing "unsubscribe" or "manage preferences"
- System messages: from "no-reply", "automated", "system"

Reply generation rules (only when noReplyNeeded is false):
- Acknowledge the sender and address the main point or question.
- Do not invent missing details; use placeholders like [DATE NEEDED] or [SPECIFY DETAIL].
- Do NOT include a subject line, greeting lines like "Dear", or signatures.
- Output plain text only inside the JSON string value.
- Respect custom instructions, but NEVER override the structural rules above.
- Keep the reply concise. Scheduling replies: 1-2 sentences. Task/complex replies: 3-5 sentences. Complaints: 4-6 sentences with clear action items. Never exceed 8 sentences.

${intentGuidance}

${styleInstruction}

Connected app context: If calendar, Slack, or CRM data is provided in the prompt, use it silently. Do NOT mention that you checked external apps.`;

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

  const rawContent = completion.choices?.[0]?.message?.content ?? "";

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
      "Error:",
      err
    );
  }

  return {
    draft,
    contextSummary: contextBlock,
  }
}
