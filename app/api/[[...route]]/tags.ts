import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod/v3";

const app = new Hono()

  .get("/", async (ctx) => {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const data = await db.user_tags.findMany({
      where: { user_id: user?.id },
    });

    return ctx.json({ data }, 200);
  })

  .post(
    "/create",
    zValidator(
      "json",
      z.object({
        tags: z.array(z.string()).min(3).max(8),
      })
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unuathorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const tagRecords = await db.tag.findMany({

        where:{
            name:{in:values.tags}

        }
      })

      const response = await db.user_tags.createMany({
          data: tagRecords.map(tag => ({
            user_id: userId,
            tag_id: tag.id,
          })),
          skipDuplicates:true
        });

        if(!response){
            return ctx.json({error:'Error creating tags'},500);
        }

        return ctx.json({response},200);
        
    }
  );

export default app;
