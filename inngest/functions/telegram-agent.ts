import { inngest } from "@/lib/inngest";
import { handleTelegramQuery } from "@/lib/openai";
import { sendTelegramMessage } from "@/lib/telegram";

export const processTelegramQueryFn = inngest.createFunction(
  { id: "process-telegram-query" },
  { event: "telegram/process.query" },
  async ({ event, step }) => {
    const { text, userId, chatId } = event.data;

    try {
      const answer = await step.run("run-telegram-agent", async () => {
        return await handleTelegramQuery(text, userId, chatId);
      });

      await step.run("send-telegram-response", async () => {
        await sendTelegramMessage(chatId, answer);
      });
      
      return { success: true };
    } catch (error) {
      console.error("Agent Error:", error);
      await step.run("send-telegram-error", async () => {
        await sendTelegramMessage(
          chatId,
          "⚠️ Sorry, I encountered an error processing your request."
        );
      });
      throw error; // Let Inngest handle retries if needed
    }
  }
);
