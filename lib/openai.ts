import OpenAI from "openai";

// const endpoint = process.env.AZURE_ENDPOINT!;
// const deploymentName = "gpt-4.1-mini";
// const apiKey = process.env.AZURE_API_KEY!;

// const openai = new OpenAI({
//   baseURL: endpoint,
//   apiKey,

// });

//You can use normal openai endpoint by uncommenting this- we use azure by default

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type UserTag = {
  tag: {
    name: string;
    description: string | null;
  };
} & {
  created_at: Date | null;
  user_id: string;
  tag_id: string;
};

export type EmailClassificationResult = {
  category: string;
  response_required: boolean;
};




export async function classifyEmail(email: {
  subject: string;
  from: string;
  bodySnippet: string;
}, tags: UserTag[], sensitivity:string): Promise<EmailClassificationResult> {
  const tagNames = tags.map((t) => t.tag.name).join("\n- ");
  const tagContext = tags
    .map(
      (t) =>
        `- ${t.tag.name}: ${t.tag.description?.trim() || "No description provided"}`,
    )
    .join("\n");
  const messages = [
    {
      role: "system" as const,
      content: `You are an email classification system. Your ONLY job is to return a valid JSON object with "category" and "response_required" fields.

      Available Categories:
      ${tagNames}

CLASSIFICATION RULES (apply in order, highest priority first):
1. FINANCE/PAYMENT: If email contains transactions, payments, UPI, bank alerts, invoices, money (₹/$) → use "Finance" if available, else use "Automated alerts" as fallback
2. DOMAIN-SPECIFIC: Match sender domain to category (bank → Finance/Automated alerts, calendar → Event update)
3. SEMANTIC CONTEXT: Analyze PURPOSE, not keywords
   - Financial transactions → Finance (or Automated alerts if Finance unavailable)
   - Calendar invites → Event update
   - Marketing → Marketing
4. KEYWORD MATCHING: Use for unclear cases
5. CONFIDENCE: If < 85% confidence → return empty string

RESPONSE_REQUIRED RULES:
- true ONLY if ALL conditions hold: (1) sent by a real human, (2) directly addressed to the recipient, (3) explicitly asks a question, requests a decision, or needs confirmation.
- false for everything else — automated alerts, receipts, notifications, newsletters, system emails, FYI updates, CC'd messages, or any message where no reply would be rude or unusual.
- NEVER set true when sender appears no-reply/notification/system-generated, or when the message is a receipt/alert/status update.
- When in doubt, default to false.
- Keep this independent from category selection. A message can have any category with response_required true/false.


SENSITIVITY GUIDANCE FOR response_required (based on the draft sensitivity setting provided by the user message):
- "always draft" => response_required should be true for nearly all human-origin emails except obvious automated/no-reply notifications.
- "if known sender AND directly addressed" => true only when sender appears known/personal and email is directly asking this user to respond.
- "if actionable" => true when concrete action/decision/reply is needed.
- "if actionable AND critical" => true only when action is needed and urgency/risk/deadline/importance is clear.

OUTPUT FORMAT (strict):
{"category": "exact_category_name", "response_required": true}
OR
{"category": "", "response_required": false}

EXAMPLES:
Input: Subject="You have done a UPI txn", From="HDFC Bank", Body="Rs.110.00 has been debited"
Output: {"category": "Finance", "response_required": false}
Input: Subject="Your project is paused", From="Appwrite <noreply@appwrite.io>", Body="Your project has been paused due to inactivity"
Output: {"category":"Automated alert", "response required": false}

`,

    },
    {
      role: "user" as const,
      content: `Classify this email into ONE category or return empty if uncertain:

Subject: ${email.subject}
From: ${email.from}
Body: ${email.bodySnippet}

Available categories:
- ${tagNames}

Category descriptions:
${tagContext}

Draft sensitivity setting:
${sensitivity}

Return only valid JSON with fields: category, response_required.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    response_format: { type: "json_object" },
    temperature: 0, 
    max_completion_tokens: 40,
    seed: 42, 
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const json = JSON.parse(content);
    return {
      category: typeof json.category === "string" ? json.category : "",
      response_required:
        typeof json.response_required === "boolean"
          ? json.response_required
          : false,
    };
  } catch {
    throw new Error("Invalid JSON response from OpenAI");
  }
}
