import { db } from "./prisma";

// lib/telegram.ts
export async function sendTelegramMessage(chatId: string, text: string) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    }
  );
}

export async function checkAndForwardToTelegram(
  userId: string,
  senderEmail: string,
  emailSubject: string,
  emailSnippet: string
) {

  console.log("telegram fn called")
  const data = await db.telegramIntegration.findUnique({
    where: { user_id: userId }
  });

  console.log("data",data)

  // Skip if telegram not enabled
  if (!data || !data.chat_id) {
    return;
  }

  const message = `📧 <b>New email from ${senderEmail}</b>\n\n<b>${emailSubject}</b>\n\n${emailSnippet}`;

  console.log(message)
  console.log("sending message")
  
  await sendTelegramMessage(data.chat_id, message);
}