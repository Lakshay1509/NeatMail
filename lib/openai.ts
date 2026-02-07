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
  const tagNames = tags.map(t => t.tag.name).join("\n- ");
  const messages = [
    {
      role: "system" as const,
      content: `You are an email classification system. Your ONLY job is to return a valid JSON object with a "category" field.

ALLOWED CATEGORIES (case-sensitive, exact match required):
- ${tagNames}

CLASSIFICATION RULES (apply in order):
1. Match keywords in Subject/From/Body to category names
2. If Subject contains a category name → return that category
3. If From domain suggests a category → return that category
4. If Body snippet clearly indicates purpose → return matching category
5. If NO clear match (confidence < 95%) → return empty string

OUTPUT FORMAT (strict):
{"category": "exact_category_name"}
OR
{"category": ""}

EXAMPLES:
Input: Subject="Meeting Tomorrow", Categories=["Meetings","Personal"]
Output: {"category": "Meetings"}

Input: Subject="Your invoice #1234", Categories=["Billing","Work"]
Output: {"category": "Billing"}

Input: Subject="Hi there", Categories=["Work","Personal"]
Output: {"category": ""}`,
    },
    {
      role: "user" as const,
      content: `Classify this email into ONE category or return empty if uncertain:

Subject: ${email.subject}
From: ${email.from}
Body: ${email.bodySnippet}

Available categories:
- ${tagNames}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    response_format: { type: "json_object" },
    temperature: 0, 
    max_completion_tokens: 20,
    seed: 42, 
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
- Keep under 100 words
- Use professional tone
- Do NOT include: subject line, greetings like "Dear", signatures
- Start directly with response

INPUT EMAIL:
From: ${emailData.from}
Subject: ${emailData.subject}
Body: ${emailData.bodySnippet}

OUTPUT:
[Your reply text OR "NO_REPLY_NEEDED"]`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a professional email reply assistant. You output either 'NO_REPLY_NEEDED' or a concise reply. Nothing else.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.3, 
    max_completion_tokens: 200, 
    top_p: 0.9, 
    frequency_penalty: 0.3, 
  });

  const response = completion.choices[0]?.message?.content ?? "";
  return response.trim() === "NO_REPLY_NEEDED" ? "" : response.trim();
}
