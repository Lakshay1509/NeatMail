import OpenAI from "openai";
import {
  downloadAttachment,
  getAttachment,
  getGmailMessageBody,
  searchGmail,
} from "./gmail";
import { redis } from "./redis";
import { escapeHtml, sendTelegramDocument, sendTelegramMessage } from "./telegram";

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

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_gmail",
      description: `Search the user's Gmail inbox using Gmail search syntax.
Returns emails with subject, sender, date, and snippet.
Use Gmail operators like:
  from:, to:, subject:, label:, has:attachment, is:unread,
  newer_than:Nd, older_than:Nd, after:YYYY/MM/DD, before:YYYY/MM/DD,
  OR, AND, -, "", category:primary/social/promotions/updates/forums
Examples:
  "from:stripe subject:invoice newer_than:30d"
  "subject:(payment OR receipt OR invoice) newer_than:90d"
  "from:john@company.com"`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query string",
          },
          max_results: {
            type: "number",
            description: "Max emails to return (default 10, max 20)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_email_content",
      description: `Fetch the full body of a specific email by its ID.
Use this when the snippet isn't enough to answer the user's question.
Only call this for IDs returned by search_gmail.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Gmail message ID from search results",
          },
        },
        required: ["message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_email_attachments",
      description: `List all downloadable attachments for a Gmail message.
Use this after search_gmail to inspect files attached to a specific email.
Returns filename, mime type, size, message_id and attachment_id.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Gmail message ID from search results",
          },
        },
        required: ["message_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_attachment_to_telegram",
      description: `Send a specific Gmail attachment directly to the current Telegram chat.
Use this only after list_email_attachments returns attachment_id and message_id.
Call this when the user asks to send/download/share a document or file.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Gmail message ID that contains the attachment",
          },
          attachment_id: {
            type: "string",
            description: "Attachment ID returned by list_email_attachments",
          },
          caption: {
            type: "string",
            description: "Optional short caption to include in Telegram",
          },
        },
        required: ["message_id", "attachment_id"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are an intelligent Gmail assistant inside a Telegram bot.
 
When the user asks about their emails:
1. Decide the best Gmail search query to answer it
2. Call search_gmail with that query
3. If you need the full content of a specific email, call get_email_content
4. If user asks for files/docs/attachments, call list_email_attachments for candidate emails
5. When the user wants the file in Telegram, call send_attachment_to_telegram
6. Answer concisely — the user is on Telegram, keep it short
 
Rules:
- Use Gmail search operators precisely
- If the first search returns nothing, retry with a broader query
- For payments/invoices: subject:(payment OR invoice OR receipt OR order)
- For client questions: search by their name or email domain
- For attachment requests, prioritize the newest matching email, list its attachments, then send the most relevant file
- Never fabricate email content
- If nothing is found after 2 searches, say so clearly
- IMPORTANT: After successfully calling an action tool (send_attachment_to_telegram), you MUST output a simple text confirmation to the user and DO NOT call the tool again.
-Don't append any extra text after the main message (e.g., avoid phrases like "Want me to send the full message?").
 
Today's date: ${new Date().toISOString().split("T")[0]}`;

// ─── Agent ────────────────────────────────────────────────────────────────────

/** Compress search results to a compact format before feeding to the LLM.
 * Cuts token usage by ~60% — the LLM only needs IDs, sender, subject, date & snippet.
 */
function compressSearchResults(results: any[]): string {
  if (results.length === 0) return "No emails found matching this query.";
  return results
    .map((r, i) =>
      `[${i + 1}] id:${r.id} | from:${r.from} | subj:${r.subject} | date:${r.date}\n    snippet: ${r.snippet?.slice(0, 200) ?? ""}`
    )
    .join("\n\n");
}

export async function handleTelegramQuery(
  userQuery: string,
  userId: string,
  chatId: string,
): Promise<string> {
  const redisKey = `telegram:history:${userId}`;
  let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // Load history (non-blocking — don't stall if Redis is slow)
  try {
    const rawHistory = await redis.get(redisKey);
    if (typeof rawHistory === "string") history = JSON.parse(rawHistory);
    else if (Array.isArray(rawHistory)) history = rawHistory;
  } catch (err) {
    console.error("Error fetching chat history from Redis:", err);
  }

  history.push({ role: "user", content: userQuery });
  // Keep only the last 8 messages to reduce context window size
  if (history.length > 8) history = history.slice(history.length - 8);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  // ── Agentic loop — max 4 iterations ──────────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      tools: TOOLS,
      tool_choice: "auto",
      messages,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // No tool calls → model is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const finalAnswer = message.content ?? "No answer generated.";

      // Persist history asynchronously — don't block the response
      history.push({ role: "assistant", content: finalAnswer });
      if (history.length > 8) history = history.slice(history.length - 8);
      redis.setex(redisKey, 3600, JSON.stringify(history)).catch((err) =>
        console.error("Error saving chat history to Redis:", err)
      );

      return escapeHtml(finalAnswer);
    }

    // ── Execute ALL tool calls in this turn IN PARALLEL ──────────────────
    const toolResults = await Promise.all(
      message.tool_calls
        .filter((tc) => tc.type === "function")
        .map(async (toolCall) => {
          let resultContent: string;
          try {
            const args = JSON.parse(toolCall.function.arguments);

            if (toolCall.function.name === "search_gmail") {
              const results = await searchGmail(
                userId,
                args.query,
                Math.min(args.max_results ?? 10, 20),
              );
              // Send compact representation to save tokens
              resultContent = compressSearchResults(results);

            } else if (toolCall.function.name === "get_email_content") {
              const email = await getGmailMessageBody(userId, args.message_id);
              // Truncate body to 3000 chars — enough for the LLM to answer
              const body = typeof email === "string" ? email : JSON.stringify(email);
              resultContent = body.slice(0, 3000);

            } else if (toolCall.function.name === "list_email_attachments") {
              const messageId =
                typeof args.message_id === "string" ? args.message_id.trim() : "";
              if (!messageId) throw new Error("message_id is required.");

              const attachments = await getAttachment(userId, messageId);
              resultContent =
                attachments.length === 0
                  ? "No downloadable attachments found for this email."
                  : JSON.stringify(
                      attachments.map((a) => ({
                        message_id: a.messageId,
                        attachment_id: a.attachmentId,
                        filename: a.filename,
                        mime_type: a.mimeType,
                        size_bytes: a.size,
                      }))
                    );

            } else if (toolCall.function.name === "send_attachment_to_telegram") {
              const messageId =
                typeof args.message_id === "string" ? args.message_id.trim() : "";
              const staleAttachmentId =
                typeof args.attachment_id === "string" ? args.attachment_id.trim() : "";
              const caption =
                typeof args.caption === "string" ? args.caption.trim() : "";

              if (!messageId) throw new Error("message_id is required to send an attachment.");
              if (!staleAttachmentId) throw new Error("attachment_id is required to send an attachment.");

              // Re-fetch to get fresh attachment IDs (Gmail rotates them)
              const attachments = await getAttachment(userId, messageId);
              if (attachments.length === 0)
                throw new Error(`No attachments found for messageId=${messageId}.`);

              const selectedAttachment =
                attachments.find((a) => a.attachmentId === staleAttachmentId) ??
                attachments[0];

              // Fire download progress + actual download in parallel
              const [, attachmentBase64] = await Promise.all([
                sendTelegramMessage(
                  chatId,
                  `⏳ Downloading <b>${escapeHtml(selectedAttachment.filename || "file")}</b>...`
                ),
                downloadAttachment(userId, messageId, selectedAttachment.attachmentId),
              ]);

              const sent = await sendTelegramDocument(chatId, {
                fileName: selectedAttachment.filename || "attachment",
                fileDataBase64: attachmentBase64,
                mimeType: selectedAttachment.mimeType,
                caption: caption || undefined,
              });

              resultContent = JSON.stringify({
                success: sent,
                filename: selectedAttachment.filename,
              });

            } else {
              resultContent = `Unknown tool: ${toolCall.function.name}`;
            }
          } catch (err) {
            resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          return {
            role: "tool" as const,
            tool_call_id: toolCall.id,
            content: resultContent,
          };
        })
    );

    // Push all tool results back into the message thread
    messages.push(...toolResults);
  }

  return "Reached maximum iterations. Try a more specific query.";
}
