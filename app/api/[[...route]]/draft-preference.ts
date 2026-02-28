import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

const app = new Hono()

  .get("/", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.draft_preference.findUnique({
      where: { user_id: userId },
      select: {
        draftPrompt: true,
        fontColor: true,
        fontSize: true,
        signature: true,
      },
    });

    if (!data) {
      return ctx.json(
        {
          data: {
            draftPrompt: null,
            fontColor: "#000000",
            fontSize: 14,
            signature: null,
          },
        },
        200,
      );
    }

    return ctx.json({ data }, 200);
  })

  .post(
    "/",
    zValidator(
      "json",
      z.object({
        draftPrompt: z.string().max(1000).optional(),
        fontColor: z.string(),
        fontSize: z.number().min(8).max(72),
        signature: z.string().optional(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const data = await db.draft_preference.upsert({
        where: { user_id: userId },
        update: {
          draftPrompt: values.draftPrompt,
          fontColor: values.fontColor,
          fontSize: values.fontSize,
          signature: values.signature,
        },
        create: {
          user_tokens: {
            connect: { clerk_user_id: userId },
          },
          draftPrompt: values.draftPrompt,
          fontColor: values.fontColor,
          fontSize: values.fontSize,
          signature: values.signature,
        },
      });

      if (!data) {
        return ctx.json({ error: "Error saving preferences" }, 500);
      }

      return ctx.json({ data }, 200);
    },
  );

export default app;
