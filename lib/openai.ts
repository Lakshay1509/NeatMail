import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function applyCorrectionsToText(
  oldText: string,
  corrections: string,
): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content: `You are an expert email drafting assistant. Your job is to refine and correct email drafts based on user feedback.

You will receive:
- An original email draft the user has written
- A set of corrections or changes the user wants applied

Your task is to apply those corrections precisely and return a clean, polished email draft. Follow these rules:
- Preserve the original tone, intent, and structure unless corrections explicitly change them
- Only modify what the corrections instruct — do not rewrite or "improve" unrelated parts
- Keep greetings, sign-offs, and formatting intact unless told otherwise
- If a correction is ambiguous, make the most natural and contextually appropriate change

Output MUST be a valid JSON object in the exact following format:
{
  "new_string": "the fully corrected email draft"
}
Do not include any other text, markdown formatting, or explanations.`,
    },
    {
      role: "user" as const,
      content: `Here is my original email draft and the corrections I want applied.

<original_draft>
${oldText}
</original_draft>

<corrections>
${corrections}
</corrections>

Apply the corrections and return the updated email draft as a JSON object.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const json = JSON.parse(content);
    return json.new_string || "";
  } catch {
    throw new Error("Invalid JSON response from OpenAI");
  }
}

// falls back to a truncated slice of the message if the model call fails
export async function generateChatTitle(firstMessage: string): Promise<string> {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  const fallback = (cleaned.slice(0, 60) || "New chat").trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system" as const,
          content:
            "You name chat conversations. Given the user's first message, reply with a concise title of 3-6 words (max 60 characters) that captures its topic. Return ONLY the title text: no surrounding quotes, no trailing punctuation, no explanation.",
        },
        { role: "user" as const, content: cleaned.slice(0, 1000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return fallback;

    // model sometimes wraps the title in quotes anyway despite the instruction
    const title = raw.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 80);
    return title || fallback;
  } catch (error) {
    console.error("[generateChatTitle] error:", error);
    return fallback;
  }
}

