import { db } from "./prisma";
import { convert } from "html-to-text";

// lib/telegram.ts
export async function sendTelegramMessage(chatId: string, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    },
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram API error:", JSON.stringify(json));
    return undefined;
  }
  return json.result?.message_id as number | undefined;
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }),
    },
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram editMessageText error:", JSON.stringify(json));
  }
}

export async function deleteTelegramMessage(chatId: string, messageId: number) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    },
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram deleteMessage error:", JSON.stringify(json));
  }
}

export async function sendTelegramDocument(
  chatId: string,
  options: {
    fileName: string;
    fileDataBase64: string;
    mimeType?: string;
    caption?: string;
  },
) {
  const binary = Buffer.from(options.fileDataBase64, "base64");
  const formData = new FormData();

  formData.append("chat_id", chatId);

  if (options.caption) {
    formData.append("caption", options.caption);
  }

  formData.append(
    "document",
    new Blob([binary], {
      type: options.mimeType ?? "application/octet-stream",
    }),
    options.fileName,
  );

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    {
      method: "POST",
      body: formData,
    },
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram sendDocument error:", JSON.stringify(json));
    return false;
  }

  return true;
}

export async function sendDraftConfirmationMessage(
  chatId: string,
  draftId: string,
  draftReply: string,
  options?: {
    senderEmail?: string;
    emailSubject?: string;
    preface?: string;
  },
) {
  const parts: string[] = [];

  if (options?.senderEmail) {
    parts.push(`📧 <b>New email from ${escapeHtml(options.senderEmail)}</b>`);
  }

  if (options?.emailSubject) {
    parts.push(`<b>${escapeHtml(options.emailSubject)}</b>`);
  }

  if (options?.preface) {
    parts.push(`<b>${escapeHtml(options.preface)}</b>`);
  }

  parts.push(`<b>Drafted reply :</b>\n<i>${escapeHtml(draftReply)}</i>`);
  parts.push("Choose what to do next:");

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: parts.join("\n\n"),
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Send", callback_data: `send:${draftId}` },
              { text: "Discard", callback_data: `discard:${draftId}` },
              { text: "Edit", callback_data: `edit:${draftId}` },
            ],
          ],
        },
      }),
    },
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram send error:", JSON.stringify(json));
    return null;
  }

  return json.result.message_id as number;
}

export function escapeHtml(text: string): string {
  return convert(text, {
    wordwrap: false,
    selectors: [
      { selector: "style", format: "skip" },   // drop <style> blocks entirely
      { selector: "script", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}

export async function checkAndForwardToTelegram(
  userId: string,
  senderEmail: string,
  emailSubject: string,
  emailSnippet: string,
  tagId: string,
  tagName: string,
) {
  const data = await db.telegramIntegration.findUnique({
    where: { user_id: userId },
  });

  if (!data || !data.chat_id) return;

  if (
    (tagName === "Action Needed" || tagName === "Pending Response") &&
    data.forward_important_mails
  ) {
    const message = `📧 <b>New Email</b>\n` +
      `<b>From:</b> ${escapeHtml(senderEmail)}\n` +
      `<b>Subject:</b> ${escapeHtml(emailSubject)}\n` +
      `<b>Category:</b> <i>${escapeHtml(tagName)}</i>\n\n` +
      `<b>Preview:</b>\n${escapeHtml(emailSnippet)}`;

    await sendTelegramMessage(data.chat_id, message);
  } else {
    const match = await db.integrationRules.findMany({
      where: {
        user_id: userId,
        AND: [{ domain: senderEmail.trim() }, { tag_id: tagId }],
      },
    });

    if (match.length === 0) {
      return;
    }

    const message = `📧 <b>New Email</b>\n` +
      `<b>From:</b> ${escapeHtml(senderEmail)}\n` +
      `<b>Subject:</b> ${escapeHtml(emailSubject)}\n` +
      `<b>Category:</b> <i>${escapeHtml(tagName)}</i>\n\n` +
      `<b>Preview:</b>\n${escapeHtml(emailSnippet)}`;

    await sendTelegramMessage(data.chat_id, message);
  }
}

// lib/telegram.ts

export async function sendDraftNotification(
  userId: string,
  senderEmail: string,
  emailSubject: string,
  draftReply: string, // the AI-generated draft content
  quickOptions: string[], // e.g. ["Yes, 3am works!", "No, let's reschedule", "Not available"]
  draft_id: string,
) {
  const data = await db.telegramIntegration.findUnique({
    where: { user_id: userId },
  });

  if (!data || !data.chat_id || !data.forward_draft_for_confirmation) {
    return;
  }

  const messageId = await sendDraftConfirmationMessage(
    data.chat_id,
    draft_id,
    draftReply,
    {
      senderEmail,
      emailSubject,
    },
  );

  if (!messageId) return;

  await db.telegramPendingDraft.deleteMany({
    where: {
      user_id: userId,
      draft_id,
    },
  });

  await db.telegramPendingDraft.create({
    data: {
      user_id: userId,
      telegram_msg_id: messageId,
      draft_id: draft_id,
      quick_options: quickOptions,
      awaiting_custom: false,
    },
  });
}
