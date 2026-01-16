import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, 
});

export type UserTag = ({
  tag: {
      name: string;
  };
} & {
  created_at: Date | null;
  user_id: string;
  tag_id: string;
});

export async function classifyEmail(email: {
  subject: string;
  from: string;
  bodySnippet: string;
}, tags: UserTag[]): Promise<string> {
  const tagNames = tags.map(t => `"${t.tag.name}"`).join(", ");
  const messages = [
    {
      role: "system" as const,
      content: `
You are an intelligent email classification agent.

Allowed Categories:
${tagNames}

Task:
Analyze the provided email metadata (Subject, From, Snippet) and assign exactly ONE category from the "Allowed Categories" list.

Guidelines:
1. **Primary Intent**: Determine the main purpose of the email. Match it to the category that best fits this purpose.
2. **Specificity**: If multiple categories seem valid, choose the one that is most specific to the content.
3: **Confidence**: Make sure you are more than 95% confident in the category you choose else return "".
4. **No Match**: If the email is vague, generic, or does not clearly fit any of the provided categories, return an empty string "".
5. **Strict Adherence**: Do NOT create new categories. You must use the EXACT names provided in the list.

Output Format:
Return a valid JSON object with a single key "category".
Example: {"category": "Work"} or {"category": ""}
`,
    },
    {
      role: "user" as const,
      content: `Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.bodySnippet}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano-2025-08-07",
    messages,
    response_format: { type: "json_object" },
    max_completion_tokens: 20, // ✅ FIX
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const json = JSON.parse(content);
    return json.category as string;
  } catch {
    throw new Error("Invalid JSON response from OpenAI");
  }
}



export async function generateEmailReply(emailData: {
  subject: string;
  from: string;
  bodySnippet: string;
}) {
  const prompt = `You are a helpful email assistant. Determine if the following email needs a reply.

From: ${emailData.from}
Subject: ${emailData.subject}
Body: ${emailData.bodySnippet}

Guidelines:
1. **Analyze sender and context**: Is this from a human requiring a response, or is it an automated alert, newsletter, receipt, or system update?
2. **If automated/no response needed**: Return strictly the text "NO_REPLY_NEEDED".
3. **If a reply is suitable**: Draft a concise, professional reply that acknowledges the email and addresses main points. Do not include subject lines or placeholders.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a professional email assistant. You only draft replies for personal/business emails, never for automated alerts.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_completion_tokens: 500, // ✅ FIX
  });

  const response = completion.choices[0]?.message?.content ?? "";
  return response.trim() === "NO_REPLY_NEEDED" ? "" : response;
}
