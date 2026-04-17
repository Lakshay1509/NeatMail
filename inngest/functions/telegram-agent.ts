import { inngest } from "@/lib/inngest";
import { handleTelegramQuery } from "@/lib/openai";
import { deleteTelegramMessage, editTelegramMessage, sendTelegramMessage } from "@/lib/telegram";

export const processTelegramQueryFn = inngest.createFunction(
  { id: "process-telegram-query" },
  { event: "telegram/process.query" },
  async ({ event, step }) => {
    const { text, userId, chatId } = event.data;

    let thinkingMsgId: number | undefined | null;

    try {
      thinkingMsgId = await step.run("send-thinking-message", async () => {
        const thinkingMessages = [
          "Searching your inbox...",
          "Reading through your emails...",
          "Scanning your Gmail...",
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
        return await sendTelegramMessage(chatId, `<i>${msg}</i>`);
      });

      const answer = await step.run("run-telegram-agent", async () => {
        let interval: NodeJS.Timeout | undefined;
        if (thinkingMsgId) {
          const thinkingMessages = [
            "Searching your inbox...",
            "Reading through your emails...",
            "Scanning your Gmail...",
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
          interval = setInterval(() => {
            const msg = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
            editTelegramMessage(chatId, thinkingMsgId as number, `<i>${msg}</i>`).catch(console.error);
          }, 3500);
        }

        try {
          return await handleTelegramQuery(text, userId, chatId);
        } finally {
          if (interval) clearInterval(interval);
        }
      });

      await step.run("send-telegram-response", async () => {
        if (thinkingMsgId) {
          await deleteTelegramMessage(chatId, thinkingMsgId);
        }
        await sendTelegramMessage(chatId, answer);
      });

      return { success: true };
    } catch (error) {
      console.error("Agent Error:", error);
      await step.run("send-telegram-error", async () => {
        if (thinkingMsgId) {
          await deleteTelegramMessage(chatId, thinkingMsgId);
        }
        await sendTelegramMessage(
          chatId,
          "⚠️ Sorry, I encountered an error processing your request.",
        );
      });
      throw error; // Let Inngest handle retries if needed
    }
  },
);
