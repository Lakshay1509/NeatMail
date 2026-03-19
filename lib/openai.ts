import OpenAI from "openai";

// const endpoint = process.env.AZURE_ENDPOINT!;
const deploymentName = "gpt-5-mini";
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

export async function classifyEmail(
  email: {
    subject: string;
    from: string;
    bodySnippet: string;
  },
  tags: UserTag[],
): Promise<EmailClassificationResult> {
  const tagDefinitions = tags
    .map((t) => {
      const description = t.tag.description?.trim();
      return description
        ? `${t.tag.name}: ${description}`
        : `${t.tag.name}: (no description)`;
    })
    .join("\n- ");
  const allowedCategories = new Set(tags.map((t) => t.tag.name));
  const messages = [
    {
      role: "system" as const,
      content: `You are an email classifier. Output ONLY valid JSON: {"category":"<name>","response_required":<bool>}

PRIORITY RULES (apply in order):
1. FINANCE: transactions, payments, UPI, bank alerts, invoices, billing, ₹/$, overdue → "Finance"
2. ACTION: anything requiring approval, decision, or reply from a human → "Action Needed"  
3. AUTOMATED: no-reply senders, monitoring alerts, receipts, OTPs → "Automated alerts"
4. MARKETING: newsletters, promotions, cold outreach → "Marketing"
5. Prefer the MORE SPECIFIC category when two fit

EXAMPLES:
From: "HDFC Bank", Subject: "UPI txn of ₹110 debited" → {"category":"Finance","response_required":false}
From: "info@vas-hosting.cz", Subject: "Unpaid hosting invoice" → {"category":"Finance","response_required":true}
From: "monitoring@company.com", Subject: "CPU at 90%" → {"category":"Automated alerts","response_required":false}

response_required: true ONLY if sender is human AND email needs reply/decision/approval.
Always false for: receipts, OTPs, newsletters, no-reply senders, automated alerts.`,
    },
    {
      role: "user" as const,
      content: `Classify this email. Pick a category from the list below — only use "" if absolutely nothing fits.
  Use category descriptions to understand intent before choosing.

  Categories (name: description):
  - ${tagDefinitions}

Subject: ${email.subject}
From: ${email.from}
Body: ${email.bodySnippet}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: deploymentName,
    messages,
    response_format: { type: "json_object" },
    // max_completion_tokens: 60, // {"category":"...","response_required":false} is ~50 chars max
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

    // BUG FIX: was `json.response_required ?? json.response_required` (no-op)
    const rawRR = json.response_required;
    const response_required =
      typeof rawRR === "boolean"
        ? rawRR
        : typeof rawRR === "string"
          ? rawRR.toLowerCase() === "true"
          : false;

    return { category, response_required };
  } catch {
    throw new Error("Invalid JSON response from OpenAI");
  }
}

export async function generateEmailReply(
  emailData: {
    subject: string;
    from: string;
    bodySnippet: string;
  },
  draftPrompt: string | null,
  user_name: string | null,
) {
  const customInstructions = draftPrompt
    ? `\n- Follow these custom instructions from the user: "${draftPrompt}"`
    : "";
  const userNameInstruction = user_name
    ? `\n- The user's name is ${user_name}. Keep this in mind and reply on their behalf.`
    : "";

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
        content:
          "You are a professional email reply assistant. You output either 'NO_REPLY_NEEDED' or a concise reply. Nothing else.",
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
