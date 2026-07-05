import { Job } from "bullmq";
import { runAgent, executeLatestPending } from "@/lib/agent/orchestrator";
import { getUserIsGmail } from "@/lib/supabase";
import { htmlToTelegramHtml } from "@/lib/telegramFormatter";
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
      const trimmed = text.trim().toLowerCase();

      if (trimmed === "confirm" || trimmed === "yes" || trimmed === "y") {
        // Confirm a previously-staged destructive action (drafts/reads never stage one).
        const result = await executeLatestPending(userId, isGmail);
        answer = htmlToTelegramHtml(result.message);
      } else {
        const result = await runAgent(text, userId, isGmail, chatId);
        answer = htmlToTelegramHtml(result.response);
        if (result.pendingConfirmation) {
          answer += `\n\n⚠️ <b>${result.pendingConfirmation.summary}</b> — reply <b>confirm</b> to proceed.`;
        }
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
