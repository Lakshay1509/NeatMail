import OpenAI from 'openai';

// const endpoint = process.env.AZURE_ENDPOINT!;
const deploymentName = 'gpt-5-nano';
// const apiKey = process.env.AZURE_API_KEY!;

// const openai = new OpenAI({
//   baseURL: endpoint,
//   apiKey,
  
// });


//You can use normal openai endpoint by uncommenting this- we use azure by default

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

export type EmailClassificationResult = {
  category: string;
  response_required: boolean;
};


export async function classifyEmail(email: {
  subject: string;
  from: string;
  bodySnippet: string;
}, tags: UserTag[]): Promise<EmailClassificationResult> {
  const tagNames = tags.map(t => t.tag.name).join("\n- ");
  const allowedCategories = new Set(tags.map((t) => t.tag.name));
  const messages = [
    {
      role: "system" as const,
      content: `You are an email classification system. Your ONLY job is to return a valid JSON object with "category" and "response_required" fields.

ALLOWED CATEGORIES (case-sensitive, exact match required):
- ${tagNames}

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
- Set "response_required": true ONLY when BOTH are true:
  1) Sender appears to be a human (personal/corporate mailbox, conversational language, not automated system patterns)
  2) Email clearly asks for a reply, decision, approval, confirmation, or manual action from the user
- Set "response_required": false for automated notifications, receipts, invoices, OTPs, alerts, newsletters, marketing campaigns, no-reply/system senders, and informational updates that do not need a direct response
- If uncertain, set "response_required": false

OUTPUT FORMAT (strict):
{"category": "exact_category_name", "response_required": true}
OR
{"category": "", "response_required": false}

EXAMPLES:
Input: Subject="You have done a UPI txn", From="HDFC Bank", Body="Rs.110.00 has been debited"
Output: {"category": "Finance", "response_required": false}

Input: Subject="Server CPU usage at 90%", From="monitoring@company.com"
Output: {"category": "Automated alerts", "response_required": false}

Input: Subject="Meeting Tomorrow", From="calendar@zoom.us"
Output: {"category": "Event update", "response_required": false}

Input: Subject="Can you review the proposal by EOD?", From="alex@partner.com"
Output: {"category": "Pending Response", "response_required": true}

Input: Subject="Your monthly invoice", Body="Payment of $99 is due"
Output: {"category": "Finance", "response_required": false}`,
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
    model: deploymentName,
    messages,
    response_format: { type: "json_object" },
    // max_completion_tokens: 20,
    seed: 42, 
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from OpenAI");

  try {
    const json = JSON.parse(content) as {
      category?: unknown;
      response_required?: unknown;
    };

    const rawCategory = typeof json.category === "string" ? json.category : "";
    const category = allowedCategories.has(rawCategory) ? rawCategory : "";

    const rawResponseRequired = json.response_required ?? json.response_required;
    const response_required =
      typeof rawResponseRequired === "boolean"
        ? rawResponseRequired
        : typeof rawResponseRequired === "string"
          ? rawResponseRequired.toLowerCase() === "true"
          : false;

    return {
      category,
      response_required,
    };
  } catch {
    throw new Error("Invalid JSON response from OpenAI");
  }
}




export async function generateEmailReply(emailData: {
  subject: string;
  from: string;
  bodySnippet: string;
}, draftPrompt: string | null,
user_name: string | null) {
  const customInstructions = draftPrompt ? `\n- Follow these custom instructions from the user: "${draftPrompt}"` : "";
  const userNameInstruction = user_name ? `\n- The user's name is ${user_name}. Keep this in mind and reply on their behalf.` : "";

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
- Use professional tone
- Do NOT include: subject line, greetings like "Dear", signatures
- Do NOT use markdown formatting (like **bold** or *italics*), output plain text only
- Start directly with response ${customInstructions}, ${userNameInstruction}

INPUT EMAIL:
From: ${emailData.from}
Subject: ${emailData.subject}
Body: ${emailData.bodySnippet}

OUTPUT:
[Your reply text OR "NO_REPLY_NEEDED"]`;

  const completion = await openai.chat.completions.create({
    model: deploymentName,
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
 
    // max_completion_tokens: 200, 
    // top_p: 0.9, 
    // frequency_penalty: 0.3, 
  });

  const response = completion.choices[0]?.message?.content ?? "";
  return response.trim() === "NO_REPLY_NEEDED" ? "" : response.trim();
}
