import { db } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

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

  .delete('/',async(ctx)=>{
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.telegramIntegration.delete({
        where:{user_id:userId}
    })

    if(!data){
        return ctx.json({error:"Error deleting telegram intgeration"},500);
    }

    return ctx.json({data},200);

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

        await sendTelegramMessage(chatId, "✅ NeatMail connected! You'll receive email alerts here.");

        return ctx.json({ success: true }, 200);
      }
    } catch (error) {
      console.error(error);
      return ctx.json({ success: false }, 500);
    }
  });

export default app;
