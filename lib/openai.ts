import OpenAI from "openai";
const endpoint = process.env.AZURE_ENDPOINT!;
const apiKey = process.env.AZURE_API_KEY!;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});

//You can use normal openai endpoint by uncommenting this- we use azure by default

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY!,
// });

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

