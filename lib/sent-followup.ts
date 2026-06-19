import OpenAI from "openai";

const endpoint = process.env.AZURE_ENDPOINT!;
const apiKey = process.env.AZURE_API_KEY!;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});

export interface SentFollowUpRequest {
  subject: string;
  body: string;
  to: string;
}

export async function checkSentRequiresFollowUp(
  request: SentFollowUpRequest,
): Promise<boolean> {
  const prompt = `You are analyzing an email that was SENT by the user. Determine if this email requires a follow-up response from the recipient.

An email requires follow-up if it asks a question, requests information, proposes a meeting or call, or otherwise expects a reply from the recipient.

Do NOT consider this as requiring follow-up if:
- The email is an unsubscribe request, newsletter opt-out, or mailing list management
- The email is purely informational with no expected response (e.g., status update, notification)
- The email is a thank-you note, acknowledgment, or brief confirmation with no question asked

Reply with exactly one word: true or false. No punctuation, no explanation, no extra text.

Subject: ${request.subject}
To: ${request.to}

Body:
${request.body.slice(0, 2000)}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that analyzes emails. Reply with exactly one word: true or false.",
      },
      { role: "user", content: prompt },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 10,
    seed: 42,
  });

  const content = completion.choices[0]?.message?.content?.trim().toLowerCase();
  return content === "true";
}

export async function generateFollowUpMessage(
  request: SentFollowUpRequest,
): Promise<string> {
  const prompt = `You are helping the user write a friendly follow-up email. The user previously sent an email and hasn't received a reply yet.

Write a short, friendly follow-up message (2-3 lines) based on the original email below. Keep it warm and polite — don't sound pushy. Reference the original email subtly if possible.

Original subject: ${request.subject}
Original to: ${request.to}

Original body:
${request.body.slice(0, 2000)}

Write only the follow-up message body, no subject line, no greeting, no sign-off. Just 2-3 lines of natural follow-up text.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content:
          "You write short, friendly, professional follow-up emails. Output only the message body — no subject, greeting, or sign-off.",
      },
      { role: "user", content: prompt },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 150,
    seed:42
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
