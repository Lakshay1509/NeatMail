import OpenAI from "openai";
import { escapeTelegramHtml, htmlToTelegramHtml } from "../telegramFormatter";
import { escapeHtml, sendTelegramDocument, sendTelegramMessage } from "../telegram";
import { redis } from "../redis";
import { getGraphClient, getOutlookMessageBody } from "../outlook";

const endpoint = process.env.AZURE_ENDPOINT!;
const apiKey = process.env.AZURE_API_KEY!;

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});

async function searchOutlook(userId: string, query: string, maxResults = 10) {
  const client = await getGraphClient(userId);
  try {
    const listRes = await client.api("/me/messages")
      .search(`"${query}"`)
      .top(maxResults)
      .select("id,subject,from,receivedDateTime,bodyPreview")
      .get();
      
    const messages = listRes.value ?? [];
    return messages.map((msg: any) => ({
      messageId: msg.id,
      subject: msg.subject,
      from: msg.from?.emailAddress?.address ?? msg.from?.emailAddress?.name,
      internalDate: msg.receivedDateTime,
      snippet: msg.bodyPreview
    }));
  } catch (error) {
    console.error("Failed to search Outlook:", error);
    return [];
  }
}

async function listOutlookAttachments(userId: string, messageId: string) {
  const client = await getGraphClient(userId);
  try {
    const res = await client.api(`/me/messages/${messageId}/attachments`)
      .select("id,name,contentType,size")
      .get();
      
    return (res.value ?? []).map((a: any) => ({
      message_id: messageId,
      attachment_id: a.id,
      filename: a.name,
      mime_type: a.contentType,
      size_bytes: a.size,
    }));
  } catch (error) {
    console.error("Failed to list Outlook attachments:", error);
    return [];
  }
}

async function downloadOutlookAttachment(userId: string, messageId: string, attachmentId: string): Promise<string> {
  const client = await getGraphClient(userId);
  const res = await client.api(`/me/messages/${messageId}/attachments/${attachmentId}`).get();
  return res.contentBytes || "";
}

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_outlook",
      description: `Search the user's Outlook inbox. Returns emails with subject, sender, date, and snippet.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Outlook search query string",
          },
          max_results: {
            type: "number",
            description: "Max emails to return",
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
      description: `Fetch the full body of an email by ID.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Outlook message ID",
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
      description: `List attachments for an Outlook message.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "Outlook message ID",
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
      description: `Send a specific Outlook attachment directly to the current Telegram chat.`,
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
          },
          attachment_id: {
            type: "string",
          },
          caption: {
            type: "string",
          },
        },
        required: ["message_id", "attachment_id"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are an intelligent Outlook assistant inside a Telegram bot.

When the user asks about their emails, execute ALL necessary steps in a single agentic run without stopping to ask the user for confirmation:
1. Decide the best Outlook search query
2. Call search_outlook with that query
3. If the user wants to READ or SUMMARIZE an email: ALWAYS call get_email_content FIRST
4. If the user asks for attachments, call list_email_attachments, then send_attachment_to_telegram
5. Answer concisely — the user is on Telegram`;

function compressSearchResults(results: any[]): string {
  if (results.length === 0) return "No emails found matching this query.";
  return JSON.stringify(results);
}

export async function handleTelegramQueryOutlook(
  userQuery: string,
  userId: string,
  chatId: string,
): Promise<string> {
  const redisKey = `telegram:history:outlook:${userId}`;
  let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  try {
    const rawHistory = await redis.get(redisKey);
    if (typeof rawHistory === "string") history = JSON.parse(rawHistory);
    else if (Array.isArray(rawHistory)) history = rawHistory;
  } catch (err) {
    console.error("Error fetching chat history from Redis:", err);
  }

  history.push({ role: "user", content: userQuery });
  if (history.length > 12) history = history.slice(history.length - 12);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  for (let i = 0; i < 8; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      tools: TOOLS,
      tool_choice: "auto",
      messages,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const finalAnswer = message.content ?? "No answer generated.";

      history.push({ role: "assistant", content: finalAnswer });
      if (history.length > 12) history = history.slice(history.length - 12);
      redis.setex(redisKey, 3600, JSON.stringify(history)).catch((err) =>
        console.error("Error saving chat history to Redis:", err)
      );

      return htmlToTelegramHtml(escapeTelegramHtml(finalAnswer));
    }

    const toolResults = await Promise.all(
      message.tool_calls
        .filter((tc) => tc.type === "function")
        .map(async (toolCall) => {
          let resultContent: string;
          try {
            const args = JSON.parse(toolCall.function.arguments);

            if (toolCall.function.name === "search_outlook") {
              const results = await searchOutlook(
                userId,
                args.query,
                Math.min(args.max_results ?? 10, 20),
              );
              resultContent = compressSearchResults(results);

            } else if (toolCall.function.name === "get_email_content") {
              const email = await getOutlookMessageBody(userId, args.message_id);
              const body = typeof email === "string" ? email : JSON.stringify(email);
              resultContent = body.slice(0, 12000);

            } else if (toolCall.function.name === "list_email_attachments") {
              const messageId = typeof args.message_id === "string" ? args.message_id.trim() : "";
              if (!messageId) throw new Error("message_id is required.");

              const attachments = await listOutlookAttachments(userId, messageId);
              resultContent =
                attachments.length === 0
                  ? "No downloadable attachments found for this email."
                  : JSON.stringify(attachments);

            } else if (toolCall.function.name === "send_attachment_to_telegram") {
              const messageId = typeof args.message_id === "string" ? args.message_id.trim() : "";
              const attachmentId = typeof args.attachment_id === "string" ? args.attachment_id.trim() : "";
              const caption = typeof args.caption === "string" ? args.caption.trim() : "";

              if (!messageId || !attachmentId) throw new Error("message_id and attachment_id are required.");

              const attachments = await listOutlookAttachments(userId, messageId);
              const selectedAttachment = attachments.find((a: any) => a.attachment_id === attachmentId) ?? attachments[0];

              if (!selectedAttachment) throw new Error("Attachment not found.");

              const [, attachmentBase64] = await Promise.all([
                sendTelegramMessage(
                  chatId,
                  `⏳ Downloading <b>${escapeHtml(selectedAttachment.filename || "file")}</b>...`
                ),
                downloadOutlookAttachment(userId, messageId, selectedAttachment.attachment_id),
              ]);

              const sent = await sendTelegramDocument(chatId, {
                fileName: selectedAttachment.filename || "attachment",
                fileDataBase64: attachmentBase64,
                mimeType: selectedAttachment.mime_type,
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

    messages.push(...toolResults);
  }

  return "Reached maximum iterations. Try a more specific query.";
}
