import OpenAI from "openai";
import { jevDecide } from "@/lib/jev";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface SentFollowUpRequest {
  subject: string;
  body: string;
  to: string;
}

// Below this P(reply expected) we don't schedule a follow-up. On 13 labeled
// sent emails, "no" scored <=0.09 and "yes" >=0.94; set a bit under the middle
// because an extra follow-up is only a draft the user reviews.
// ponytail: tuned on synthetic mail, re-pick from real logged probabilities.
const FOLLOW_UP_THRESHOLD = 0.4;

export async function checkSentRequiresFollowUp(
  request: SentFollowUpRequest,
): Promise<boolean> {
  const { expects_reply } = await jevDecide(
    {
      subject: request.subject,
      to: request.to,
      body: request.body.slice(0, 2000),
    },
    {
      expects_reply: {
        type: "noul",
        instructions:
          "This email was SENT by the user. Does it expect a reply from the recipient?",
        criteria: {
          true: "It asks a question, requests information, proposes a meeting or call, or otherwise expects the recipient to respond.",
          false:
            "It is purely informational (status update, shared notes, notification), a thank-you, acknowledgment or brief confirmation with no question, or an unsubscribe / mailing-list request.",
        },
      },
    },
  );

  console.log(`[sent-followup] jev expects_reply=${expects_reply.noul}`);
  return expects_reply.noul >= FOLLOW_UP_THRESHOLD;
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
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You write short, friendly, professional follow-up emails. Output only the message body — no subject, greeting, or sign-off.",
      },
      { role: "user", content: prompt },
    ],
    reasoning_effort: "low",
    max_completion_tokens: 500,
    seed: 42,
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
