import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, 
});

export async function classifyEmail(email: {
  subject: string;
  from: string;
  bodySnippet: string;
}): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content: `You are an email classifier. Classify the email into exactly one of these categories:
"Action Needed", "Read only", "Discussion", "Automated alerts", "Event update", "Pending Response", "Resolved", "Marketing".
Respond ONLY with valid JSON: {"category": "chosen category"}.`,
    },
    {
      role: "user" as const,
      content: `Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.bodySnippet}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
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
  const prompt = `You are a helpful email assistant. Draft a professional email reply for the following email:

From: ${emailData.from}
Subject: ${emailData.subject}
Body: ${emailData.bodySnippet}

Write a concise, professional reply that:
- Acknowledges the email
- Addresses the main points
- Is friendly and professional
- Ends with a clear call-to-action or closing

Only provide the email body, no subject line.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a professional email assistant that drafts clear, concise email responses.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_completion_tokens: 500, // ✅ FIX
  });

  return completion.choices[0]?.message?.content ?? "";
}
