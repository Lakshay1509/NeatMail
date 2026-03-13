import { EmailEntities, EmailIntent, IncomingEmail } from "./types"
import OpenAI from "openai"

const openai = new OpenAI({
  baseURL: process.env.AZURE_ENDPOINT,
  apiKey: process.env.AZURE_API_KEY,
})

const deploymentName = "gpt-5-nano"

export async function extractEntities(
  email: IncomingEmail,
  timezone: string
): Promise<EmailEntities> {

  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone })
  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "long" })

  const completion = await openai.chat.completions.create({
    model: deploymentName,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured information from emails and always return valid JSON."
      },
      {
        role: "user",
        content: `Today is ${today} (${dayOfWeek}), timezone ${timezone}.

Extract from this email and return ONLY valid JSON with this structure:

{
  "intent": "scheduling_request|task_assignment|question|follow_up|general",
  "keywords": ["max 3 topic keywords"],
  "mentionedDates": [{ "raw": "Wednesday at 5pm", "iso": "2026-03-18T17:00:00+05:30" }]
}
IMPORTANT: All ISO dates must include the timezone offset for ${timezone}. Never use bare local time without an offset.
If someone says "this Friday" and today IS Friday, "this Friday" means TODAY (${today}), not next week.
If someone says "next Friday", that means the Friday of next week.
Resolve all relative dates from today's date ${today}

Email subject: ${email.subject}
Email body: ${email.body.slice(0, 1500)}`
      }
    ]
  })

  const text = completion.choices?.[0]?.message?.content?.trim()

  let parsed: Record<string, unknown> = {}

  try {
    if (text) parsed = JSON.parse(text)
  } catch {
    // fallback to defaults
  }

  return {
    senderEmail: email.senderEmail,
    senderName: email.senderName,
    senderDomain: email.senderEmail.split("@")[1],
    keywords: (parsed.keywords as string[]) ?? [],
    mentionedDates:
      (parsed.mentionedDates as { raw: string; iso: string }[]) ?? [],
    intent: (parsed.intent as EmailIntent) ?? "general",
    timezone,
  }
}