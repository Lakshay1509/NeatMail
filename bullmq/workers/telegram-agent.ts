import { Job } from "bullmq";
import { handleTelegramQueryGmail } from "@/lib/chat/gmail";
import { handleTelegramQueryOutlook } from "@/lib/chat/outlook";
import { getUserIsGmail } from "@/lib/supabase";
import {
  deleteTelegramMessage,
  editTelegramMessage,
  sendTelegramMessage,
} from "@/lib/telegram";

interface TelegramQueryData {
  text: string;
  userId: string;
  chatId: string;
}

export async function telegramAgent(job: Job<TelegramQueryData>) {
  const { text, userId, chatId } = job.data;

  let thinkingMsgId: number | undefined | null;

  try {
    const thinkingMessages = [
      "Searching your inbox...",
      "Reading through your emails...",
      "Scanning your Google Workspace/M365...",
      "Looking up relevant conversations...",
      "Fetching email threads...",
      "Analyzing your messages...",
      "Digging through your inbox...",
      "Cross-referencing your conversations...",
      "Retrieving matching emails...",
      "Checking your recent threads...",
      "Combing through your messages...",
      "Pulling up relevant emails...",
    ];
    const msg =
      thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
    thinkingMsgId = await sendTelegramMessage(chatId, `<i>${msg}</i>`);

    let interval: NodeJS.Timeout | undefined;
    if (thinkingMsgId) {
      interval = setInterval(() => {
        const randomMsg =
          thinkingMessages[
            Math.floor(Math.random() * thinkingMessages.length)
          ];
        editTelegramMessage(
          chatId,
          thinkingMsgId as number,
          `<i>${randomMsg}</i>`,
        ).catch(console.error);
      }, 3500);
    }

    let answer: string;
    try {
      const { isGmail } = await getUserIsGmail(userId);

      if (isGmail) {
        answer = await handleTelegramQueryGmail(text, userId, chatId);
      } else {
        answer = await handleTelegramQueryOutlook(text, userId, chatId);
      }
    } finally {
      if (interval) clearInterval(interval);
    }

    if (thinkingMsgId) {
      await deleteTelegramMessage(chatId, thinkingMsgId);
    }
    await sendTelegramMessage(chatId, answer);

    return { success: true };
  } catch (error) {
    console.error("Agent Error:", error);
    if (thinkingMsgId) {
      await deleteTelegramMessage(chatId, thinkingMsgId);
    }
    await sendTelegramMessage(
      chatId,
      "⚠️ Sorry, I encountered an error processing your request.",
    );
    throw error;
  }
}

export default telegramAgent;
