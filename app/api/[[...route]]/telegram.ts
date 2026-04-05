import { deleteGmailDraft, sendGmailDraft, updateGmailDraft } from "@/lib/gmail";
import { db } from "@/lib/prisma";
import {
  sendDraftConfirmationMessage,
  sendTelegramMessage,
} from "@/lib/telegram";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

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

  .get('/rules',async(ctx)=>{
    const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const data = await db.integrationRules.findMany({
        where:{user_id:userId}
      })

      return ctx.json({data},200);

  })

  .get('/prefernces',async(ctx)=>{

    const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const data = await db.telegramIntegration.findMany({
        where:{user_id:userId}
      })

      return ctx.json({data},200);

  })

  .post('/prefernces',zValidator("json",
    z.object({
      fwd_imp_mails:z.boolean(),
      fwd_draft:z.boolean()
    })
  ),async(ctx)=>{

     const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const data = await db.telegramIntegration.update({
        where:{user_id:userId},
        data:{
          forward_draft_for_confirmation:values.fwd_draft,
          forward_important_mails:values.fwd_imp_mails
        }
      })


      if(!data){
        return ctx.json({error:"Error updating prefernces"},500);
      }

      return ctx.json({data},200)



  })

  .post(
    "/rules",
    zValidator(
      "json",
      z
        .array(
          z.object({
            domain: z.string(),
            tag_id: z.string(),
          }),
        )
        .min(1)
        .max(10),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const data = await db.$transaction([
        db.integrationRules.deleteMany({
          where: { user_id: userId },
        }),

        db.integrationRules.createMany({
          data: values.map((v) => ({
            domain: v.domain.trim(),
            tag_id: v.tag_id,
            user_id: userId,
          })),
        }),
      ]);

      if(!data){
        return ctx.json({error:"Error creating rules"},500);
      }

      return ctx.json({success:true},200);
    },
  )

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
          "NeatMail connected successfully! You'll now receive email alerts here. Refresh the dashboard to see the updated status."
        );

        return ctx.json({ success: true }, 200);
      }

      if (body.callback_query) {
        const { id, data, message } = body.callback_query;
        const chatId = String(message.chat.id);

        await answerCallbackQuery(id); // acknowledge button tap immediately

        const integration = await db.telegramIntegration.findUnique({
          where: { chat_id: chatId },
        });

        if (!integration) {
          return ctx.json({ ok: true }, 200);
        }

        const [action, draft_id] = String(data).split(":");

        const pending = await db.telegramPendingDraft.findFirst({
          where: {
            draft_id,
            user_id: integration.user_id,
          },
        });

        if (!pending) {
          await editMessageText(
            chatId,
            message.message_id,
            "Draft not found or already handled.",
          );
          return ctx.json({ ok: true }, 200);
        }

        if (action === "send") {
          await sendGmailDraft(pending.user_id, draft_id);
          await editMessageText(
            chatId,
            message.message_id,
            "Reply sent.",
          );
          await db.telegramPendingDraft.delete({ where: { id: pending.id } });
        } else if (action === "edit" || action === "custom") {
          await db.telegramPendingDraft.update({
            where: { id: pending.id },
            data: { awaiting_custom: true },
          });
          await editMessageText(
            chatId,
            message.message_id,
            "<b>Type your edited reply.</b>\n\nI will send it back for confirmation.",
          );
        } else if (action === "discard") {
          await deleteGmailDraft(pending.user_id, draft_id);
          await editMessageText(
            chatId,
            message.message_id,
            " Draft discarded.",
          );
          await db.telegramPendingDraft.delete({ where: { id: pending.id } });
        }
      }

      if (body.message?.text) {
        const chatId = String(body.message.chat.id);
        const text = body.message.text;

        await sendTelegramMessage(chatId,"Re-writing draft hold on....")

        const integration = await db.telegramIntegration.findUnique({
          where: { chat_id: chatId },
        });
        if (!integration) return ctx.json({ ok: true }, 200);

        const pending = await db.telegramPendingDraft.findFirst({
          where: { user_id: integration.user_id, awaiting_custom: true },
        });

        if (pending) {
          const updatedText = text.trim();

          if (!updatedText) {
            await sendTelegramMessage(chatId, "⚠️ Empty reply is not allowed.");
            return ctx.json({ ok: true }, 200);
          }

          const updatedDraft = await updateGmailDraft(
            pending.user_id,
            pending.draft_id,
            updatedText,
          );

          const confirmationMessageId = await sendDraftConfirmationMessage(
            chatId,
            pending.draft_id,
            updatedDraft.text,
            { preface: "Draft updated" },
          );

          await db.telegramPendingDraft.update({
            where: { id: pending.id },
            data: {
              awaiting_custom: false,
              telegram_msg_id: confirmationMessageId ?? pending.telegram_msg_id,
            },
          });

          if (!confirmationMessageId) {
            await sendTelegramMessage(
              chatId,
              "⚠️ Could not send the confirmation card. Please tap edit again.",
            );
          }
        }
      }

      return ctx.json({ ok: true }, 200);
    } catch (error) {
      console.error(error);
      return ctx.json({ success: false }, 500);
    }
  });

export default app;
