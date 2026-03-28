import { db } from "./prisma";

// lib/telegram.ts
export async function sendTelegramMessage(chatId: string, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    }
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram API error:", JSON.stringify(json));
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function checkAndForwardToTelegram(
  userId: string,
  senderEmail: string,
  emailSubject: string,
  emailSnippet: string
) {
  const data = await db.telegramIntegration.findUnique({
    where: { user_id: userId },
  });

  if (!data || !data.chat_id) return;

  const message = `📧 <b>New email from ${escapeHtml(senderEmail)}</b>\n\n<b>${escapeHtml(emailSubject)}</b>\n\n${escapeHtml(emailSnippet)}`;

  await sendTelegramMessage(data.chat_id, message);
}

// lib/telegram.ts

export async function sendDraftNotification(
  userId: string,
  senderEmail: string,
  emailSubject: string,
  draftReply: string,      // the AI-generated draft content
  quickOptions: string[]   // e.g. ["Yes, 3am works!", "No, let's reschedule", "Not available"]
) {

  const data = await db.telegramIntegration.findUnique({
    where: { user_id: userId },
  });

  if (!data || !data.chat_id) return;
  const message =
    `📧 <b>New email from ${escapeHtml(senderEmail)}</b>\n` +
    `<b>${escapeHtml(emailSubject)}</b>\n\n` +
    `✏️ <b>Draft reply:</b>\n<i>${escapeHtml(draftReply)}</i>`;

  // Build inline keyboard: quick options + custom
  const optionButtons = quickOptions.map((opt) => ([{
    text: opt,
  }]));

  const keyboard = [
    ...optionButtons,
    // [{ text: "✏️ Send custom reply", callback_data: `custom:${gmailDraftId}` }],
    // [{ text: "🗑️ Discard draft", callback_data: `discard:${gmailDraftId}` }],
  ];

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: data.chat_id,
        text: message,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }),
    }
  );

  const json = await res.json();
  if (!json.ok) {
    console.error("Telegram send error:", json);
    return;
  }

}