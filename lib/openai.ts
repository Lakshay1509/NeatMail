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
- SPEED: When you can predict the next tool call ahead of time, call multiple tools together in the same turn — do not wait for one result before deciding to call the next.
- If a search may return nothing, send both a narrow and a broader query simultaneously in the same turn instead of retrying sequentially.
- For payments/invoices: subject:(payment OR invoice OR receipt OR order)
- For client questions: search by their name or email domain
- For attachment requests, prioritize the newest matching email, list its attachments, then send the most relevant file
- Never fabricate email content
- If nothing is found after 2 searches, say so clearly
- IMPORTANT: After successfully calling an action tool (send_attachment_to_telegram), you MUST output a simple text confirmation to the user and DO NOT call the tool again.
- Don't append any extra text after the main message (e.g., avoid phrases like "Want me to send the full message?").
 
Today's date: ${new Date().toISOString().split("T")[0]}`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function handleTelegramQuery(
  userQuery: string,
  userId: string,
  chatId: string,
): Promise<string> {
  const redisKey = `telegram:history:${userId}`;
  let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  
  try {
    const rawHistory = await redis.get(redisKey);
    if (typeof rawHistory === "string") {
      history = JSON.parse(rawHistory);
    } else if (Array.isArray(rawHistory)) {
      history = rawHistory;
    }
  } catch (err) {
    console.error("Error fetching chat history from Redis:", err);
  }

  history.push({ role: "user", content: userQuery });

  // Keep only the last 6 messages (sliding window) to save context window and Redis space
  if (history.length > 6) {
    history = history.slice(history.length - 6);
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  // Agentic loop — max 5 iterations
  for (let i = 0; i < 5; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini", // was "gpt-4o"
      tools: TOOLS,
      tool_choice: "auto",
      messages,
    });

    const message = response.choices[0].message;
    messages.push(message);

    // No tool calls → model is done, return the answer
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const finalAnswer = message.content ?? "No answer generated.";
      
      try {
        // Append assistant response to history and save to Redis with 1 hour TTL (3600 seconds)
        history.push({ role: "assistant", content: finalAnswer });
        if (history.length > 6) history = history.slice(history.length - 6);
        await redis.setex(redisKey, 3600, JSON.stringify(history));
      } catch (err) {
        console.error("Error saving chat history to Redis:", err);
      }

      return escapeHtml(finalAnswer);
    }

    // Process every tool call in this turn
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;

      let resultContent: string;

      try {
        const args = JSON.parse(toolCall.function.arguments);

        if (toolCall.function.name === "search_gmail") {
          const results = await searchGmail(
            userId,
            args.query,
            Math.min(args.max_results ?? 10, 20),
          );
          resultContent =
            results.length === 0
              ? "No emails found matching this query."
              : JSON.stringify(results);
        } else if (toolCall.function.name === "get_email_content") {
          const email = await getGmailMessageBody(userId, args.message_id);
          resultContent = JSON.stringify(email);
        } else if (toolCall.function.name === "list_email_attachments") {
          const messageId =
            typeof args.message_id === "string" ? args.message_id.trim() : "";

          if (!messageId) {
            throw new Error("message_id is required to list attachments.");
          }

          const attachments = await getAttachment(userId, messageId);
          resultContent =
            attachments.length === 0
              ? "No downloadable attachments found for this email."
              : JSON.stringify(
                attachments.map((attachment) => ({
                  message_id: attachment.messageId,
                  attachment_id: attachment.attachmentId,
                  filename: attachment.filename,
                  mime_type: attachment.mimeType,
                  size_bytes: attachment.size,
                })),
              );
        } else if (toolCall.function.name === "send_attachment_to_telegram") {
          const messageId =
            typeof args.message_id === "string" ? args.message_id.trim() : "";
          const staleAttachmentId =
            typeof args.attachment_id === "string"
              ? args.attachment_id.trim()
              : "";
          const caption =
            typeof args.caption === "string" ? args.caption.trim() : "";

  

          if (!messageId) {
            throw new Error("message_id is required to send an attachment.");
          }

          if (!staleAttachmentId) {
            throw new Error("attachment_id is required to send an attachment.");
          }

          // Always re-fetch attachments to get fresh IDs.
          // Gmail attachment IDs rotate between API calls, so the ID the LLM
          // stored from a prior list_email_attachments call may be stale.
          const attachments = await getAttachment(userId, messageId);
          
          if (attachments.length === 0) {
            throw new Error(`No attachments found for messageId=${messageId}.`);
          }

          // Try to match by stale ID first; if Gmail rotated it, fall back to first attachment.
          const selectedAttachment =
            attachments.find((a) => a.attachmentId === staleAttachmentId) ??
            attachments[0];

          const freshAttachmentId = selectedAttachment.attachmentId;
          

          await sendTelegramMessage(chatId, `⏳ Downloading <b>${escapeHtml(selectedAttachment.filename || "file")}</b>...`);

          const attachmentBase64 = await downloadAttachment(
            userId,
            messageId,
            freshAttachmentId,
          );
         

          const sent = await sendTelegramDocument(chatId, {
            fileName: selectedAttachment.filename || "attachment",
            fileDataBase64: attachmentBase64,
            mimeType: selectedAttachment.mimeType,
            caption: caption || undefined,
          });
          
          resultContent = JSON.stringify({
            success: sent,
            message_id: messageId,
            attachment_id: freshAttachmentId,
            filename: selectedAttachment.filename,
          });
        } else {
          resultContent = `Unknown tool: ${toolCall.function.name}`;
        }
      } catch (err) {
        resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultContent,
      });
    }
  }

  return "Reached maximum iterations. Try a more specific query.";
}
