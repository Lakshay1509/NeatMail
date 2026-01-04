import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!, 
});

export async function classifyEmail(email: { subject: string; from: string; bodySnippet: string }): Promise<string> {
  const messages = [
    {
      role: 'system' as const,
      content: `You are an email classifier. Classify the email into exactly one of these categories: "Action Needed", "Read only", "Discussion", "Automated alerts", "Event update", "Pending Response", "Resolved", "Marketing". 
      Respond ONLY with valid JSON: {"category": "chosen category"}. Base decision on subject, sender, and body snippet.`,
    },
    {
      role: 'user' as const,
      content: `Subject: ${email.subject}\nFrom: ${email.from}\nSnippet: ${email.bodySnippet}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 20,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  try {
    const json = JSON.parse(content);
    return json.category as string;
  } catch {
    throw new Error('Invalid JSON response from OpenAI');
  }
}
