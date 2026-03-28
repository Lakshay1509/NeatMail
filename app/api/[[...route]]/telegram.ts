import { db } from "@/lib/prisma";
import { escapeHtml, sendTelegramMessage } from "@/lib/telegram";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

async function answerCallbackQuery(callbackQueryId: string) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    },
  );
}

async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
) {
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
      }),
    },
  );
}

const app = new Hono()

  .get("/enabled", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.telegramIntegration.findUnique({
      where: { user_id: userId },
    });

    if (!data) {
      return ctx.json({ enabled: false }, 200);
    }

    return ctx.json({ enabled: true }, 200);
  })

  .delete("/", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.telegramIntegration.delete({
      where: { user_id: userId },
    });

    if (!data) {
      return ctx.json({ error: "Error deleting telegram intgeration" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .post("/webhook", async (ctx) => {
    const body = await ctx.req.json();
    const message = body.message;

    try {
      if (message?.text?.startsWith("/start")) {
        const userId = message.text.split(" ")[1];
        const chatId = String(message.chat.id);

        await db.telegramIntegration.upsert({
          where: {
            user_id: userId,
          },
          update: {
            chat_id: chatId,
          },
          create: {
            user_id: userId,
            chat_id: chatId,
          },
        });

        await sendTelegramMessage(
          chatId,
          "✅ NeatMail connected! You'll receive email alerts here.",
        );

        return ctx.json({ success: true }, 200);
      }

      if (body.callback_query) {
        const { id, data, message } = body.callback_query;
        const chatId = String(message.chat.id);

        await answerCallbackQuery(id); // acknowledge button tap immediately

        const [action, draft_id, ...rest] = data.split(":");
        const customText = rest.join(":"); // in case text has colons

        const pending = await db.telegramPendingDraft.findFirst({
          where: { draft_id: draft_id },
        });

        if (!pending) {
          await editMessageText(
            chatId,
            message.message_id,
            "⚠️ Draft not found or already handled.",
          );
          return ctx.json({ ok: true }, 200);
        }

        if (action === "send") {
          // Update draft with chosen option text, then send
          // await updateGmailDraft(pending.user_id, gmailDraftId, customText);
          // await sendGmailDraft(pending.user_id, gmailDraftId);
          await editMessageText(
            chatId,
            message.message_id,
            `✅ Reply sent: "<i>${escapeHtml(customText)}</i>"`,
          );
          await db.telegramPendingDraft.delete({ where: { id: pending.id } });
        } else if (action === "custom") {
          // Ask user to type their reply — store state
          await db.telegramPendingDraft.update({
            where: { id: pending.id },
            data: { awaiting_custom: true },
          });
          await editMessageText(
            chatId,
            message.message_id,
            "✏️ <b>Type your custom reply</b> and send it here:",
          );
        } else if (action === "discard") {
          // await deleteGmailDraft(pending.user_id, gmailDraftId);
          await editMessageText(
            chatId,
            message.message_id,
            "🗑️ Draft discarded.",
          );
          await db.telegramPendingDraft.delete({ where: { id: pending.id } });
        }
      }

      if (body.message?.text) {
        const chatId = String(body.message.chat.id);
        const text = body.message.text;

        const integration = await db.telegramIntegration.findUnique({
          where: { chat_id: chatId },
        });
        if (!integration) return ctx.json({ ok: true }, 200);

        const pending = await db.telegramPendingDraft.findFirst({
          where: { user_id: integration.user_id, awaiting_custom: true },
        });

        if (pending) {
          // await updateGmailDraft(pending.user_id, pending.gmail_draft_id, text);
          // await sendGmailDraft(pending.user_id, pending.gmail_draft_id);
          await db.telegramPendingDraft.delete({ where: { id: pending.id } });

          await sendTelegramMessage(chatId, `✅ Custom reply sent!`);
        }
      }

      return ctx.json({ ok: true }, 200);
    } catch (error) {
      console.error(error);
      return ctx.json({ success: false }, 500);
    }
  });

export default app;
