import { Job } from "bullmq";
import { runAgent, executeLatestPending } from "@/lib/agent/orchestrator";
import { friendlyError } from "@/lib/agent/errors";
import { getUserIsGmail, getUserSubscribed } from "@/lib/supabase";
import { escapeTelegramHtml, htmlToTelegramHtml } from "@/lib/telegramFormatter";
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

  // Defense-in-depth: the webhook checks subscription before enqueuing, but
  // re-verify here in case entitlement lapsed between enqueue and processing.
  const subscription = await getUserSubscribed(userId);
  if (!subscription.subscribed) {
    await sendTelegramMessage(
      chatId,
      "Your NeatMail plan isn't active, so I can't read your inbox. Start a free trial or pick a plan at https://dashboard.neatmail.app/billing, then message me again.",
    );
    return { skipped: true, reason: "not subscribed" };
  }

  let thinkingMsgId: number | undefined | null;
  let isGmail = true;

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
      ({ isGmail } = await getUserIsGmail(userId));
      const trimmed = text.trim().toLowerCase();

      // only the literal word: a "yes" meant for an ordinary question must not
      // run a trash/archive the user staged minutes earlier
      if (trimmed === "confirm") {
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
      `⚠️ ${escapeTelegramHtml(friendlyError(error, isGmail ? "gmail" : "outlook").message)}`,
    );
    // not rethrown: the queue retries 3x, which would send the user 3 apologies
    return { success: false };
  }
}

export default telegramAgent;
