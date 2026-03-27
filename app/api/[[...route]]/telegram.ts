import { db } from "@/lib/prisma";
import { Hono } from "hono";

const app = new Hono()


    

    .post('/webhook',async(ctx)=>{
        const body = await ctx.req.json()
        const message = body.message

        try{


        if (message?.text?.startsWith("/start")) {
                const userId = message.text.split(" ")[1]; 
                const chatId = String(message.chat.id)

                await db.telegramIntegration.upsert({
                    where: {
                        user_id: userId
                    },
                    update: {
                        chat_id: chatId
                    },
                    create: {
                        user_id: userId,
                        chat_id: chatId
                    }
                })

                return ctx.json({"success":true},200);
        }
        }catch(error){

            console.error(error);
            return ctx.json({"success":false},500);
        }

    })





export default app;