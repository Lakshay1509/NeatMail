// src/context-engine/pipeline.ts

import { ContextAssembler }        from "./assembler"
import { GoogleCalendarProvider } from "./providers/google-calender"
import { OutlookCalendarProvider } from "./providers/outlook-calender"

import { EmailEntities, EmailIntent, IncomingEmail }            from "./types"

// ── Register all providers here — this is the ONLY file
//    you touch when adding a new integration ──────────────

import OpenAI from "openai";

const endpoint = process.env.AZURE_ENDPOINT!;
const deploymentName = "gpt-5-mini";
const apiKey = process.env.AZURE_API_KEY!;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});
// assembler.register(new SlackProvider())       ← you'll add this next
// assembler.register(new JiraProvider())        ← then this
// assembler.register(new NotionProvider())      ← and so on forever

// ── Main function your webhook calls ───────────────────────

export async function buildContextAndDraft(
  email:    IncomingEmail,
  isGmail: boolean,
  timezone: string,
  draftPrompt: string | null,
  user_name: string | null,
  retrieved_history: Record<string, any>[],
  thread_context: Record<string, any>[] | null,
  intent:         EmailIntent,
  keywords:       string[],
  mentionedDates: { raw: string; iso: string }[],
  

): Promise<{ draft: string; contextSummary: string; quickOptions: string[] }> {

  const assembler = new ContextAssembler()

  if (isGmail) {
    assembler.register(new GoogleCalendarProvider())
  } else {
    assembler.register(new OutlookCalendarProvider())
  }



  const entities: EmailEntities={
    senderEmail:email.senderEmail,
    senderName:email.senderName,
   senderDomain: email.senderEmail.split("@")[1],
    keywords:keywords,
    mentionedDates:mentionedDates,
    intent:intent,
    timezone:timezone

  }
  
  // 2. Assemble context from all relevant providers in parallel
  const cards = await assembler.assemble(email, entities)

  // 3. Build prompt block from cards
  const contextBlock = cards.length > 0
    ? `## Context from connected apps\n\n${cards.map(c => `### ${c.providerName}\n${c.summary}`).join("\n\n")}`
    : ""
  
  const customInstructions = draftPrompt ? `\n- Follow these custom instructions from the user: "${draftPrompt}"` : "";
  const userNameInstruction = user_name ? `\n- The user's name is ${user_name}. Keep this in mind and reply on their behalf.` : "";

  const prompt = `You are an email reply generator. Follow these rules strictly:

STEP 1: DETECTION
Check if email is:
- Automated (contains: "noreply", "do-not-reply", "notification", "alert", "receipt", "invoice")
- Newsletter (contains: "unsubscribe", "manage preferences")
- System message (From contains: "no-reply", "automated", "system")

If ANY above is true → Output exactly: "NO_REPLY_NEEDED" with no quick options

STEP 2: REPLY GENERATION (only if Step 1 is false)

Goal:
Generate a neutral, minimal draft reply that a human assistant might write. 
Do not assume missing details. If specific information is required, leave a clear placeholder.

Requirements:
- Acknowledge the sender's message
- Address the main point/question in a neutral way
- If information is missing, use placeholders like [DETAIL], [DATE], [LINK], [PERSON]
- Avoid making commitments or promises
- Use a professional and neutral tone
- Keep the reply under 120 words
- Output plain text only
- Do NOT include subject line
- Do NOT include greetings like "Dear"
- Do NOT include signatures
- Do NOT use markdown formatting

Context:
History with user: ${retrieved_history}
Ongoing thread context: ${thread_context}

Start directly with the response.

Additional instructions:
${customInstructions}
${userNameInstruction}

STEP 3: QUICK OPTIONS
Generate 3 quick reply options that the user can use to respond. These should be:
- Contextual to the email content
- Short and actionable (5-15 words each max)
- Diverse (cover different possible responses)
- Professional

INPUT EMAIL:
From: ${email.senderName}
Subject: ${email.subject}
Body: ${email.body}

OUTPUT FORMAT:
DRAFT:
[Your reply text OR "NO_REPLY_NEEDED"]

QUICK_OPTIONS:
[Option 1]
[Option 2]
[Option 3]`;



  // 4. Generate draft
  const completion = await openai.chat.completions.create({
  model: deploymentName,
  messages: [
    {
      role: "system",
      content:
        `You are a professional email assistant. Use the provided context to write an accurate, natural reply. Do not mention that you checked any external apps. Output the draft and 3 quick options in the specified format.`
    },
    {
      role: "user",
      content: prompt
    },
  ]
});

const response = completion.choices?.[0]?.message?.content ?? "";

// Parse response to extract draft and quick options
const draftMatch = response.match(/DRAFT:\s*([\s\S]*?)(?=QUICK_OPTIONS:|$)/);
const draft = draftMatch ? draftMatch[1].trim() : "";

const optionsMatch = response.match(/QUICK_OPTIONS:\s*([\s\S]*?)$/);
const quickOptionsText = optionsMatch ? optionsMatch[1].trim() : "";
const quickOptions = quickOptionsText
  .split("\n")
  .map(line => line.replace(/^[-•*]\s*/, "").trim())
  .filter(line => line.length > 0)
  .slice(0, 3);

  return {
    draft,
    contextSummary: contextBlock,
    quickOptions,
  }
}