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
  relationship_context:string|null,
  topic_context:string|null,
  behavioural_context:string|null,
  intent:         EmailIntent,
  keywords:       string[],
  mentionedDates: { raw: string; iso: string }[],
  

): Promise<{ draft: string; contextSummary: string }> {

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
  const relationshipInstruction = relationship_context ? `\n- Relationship context (how to address them): ${relationship_context}` : "";
  const topicInstruction = topic_context ? `\n- Topic context (what this is about): ${topic_context}` : "";
  const behaviouralInstruction = behavioural_context ? `\n- Behavioural context (tone and style): ${behavioural_context}` : "";

  const prompt = `You are an email reply generator. Follow these rules strictly:

STEP 1: DETECTION
Check if email is:
- Automated (contains: "noreply", "do-not-reply", "notification", "alert", "receipt", "invoice")
- Newsletter (contains: "unsubscribe", "manage preferences")
- System message (From contains: "no-reply", "automated", "system")

If ANY above is true → Output exactly: "NO_REPLY_NEEDED"

STEP 2: REPLY GENERATION (only if Step 1 is false)
Requirements:
- Acknowledge the sender's message
- Address the main point/question
- Use professional tone
- Keep the full reply under 120 words
- Do NOT include: subject line, greetings like "Dear", signatures
- Do NOT use markdown formatting (like **bold** or *italics*), output plain text only
- Context : ${contextBlock}${relationshipInstruction}${topicInstruction}${behaviouralInstruction}
- Start directly with response ${customInstructions}, ${userNameInstruction}

INPUT EMAIL:
From: ${email.senderName}
Subject: ${email.subject}
Body: ${email.body}

OUTPUT:
[Your reply text OR "NO_REPLY_NEEDED"]`;

  // 4. Generate draft
  const completion = await openai.chat.completions.create({
  model: deploymentName,
  messages: [
    {
      role: "system",
      content:
        `You are a professional email assistant. Use the provided context to write an accurate, natural reply. Do not mention that you checked any external apps.You output either 'NO_REPLY_NEEDED' or a concise reply. Nothing else.`
    },
    {
      role: "user",
      content: prompt
    },
  ]
});

const draft = completion.choices?.[0]?.message?.content ?? "";

  return {
    draft,
    contextSummary: contextBlock,
  }
}