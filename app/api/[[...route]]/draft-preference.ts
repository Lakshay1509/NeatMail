import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { getUserTier } from "@/lib/tier-guard";
import { sanitizeSignatureHtml, MAX_SIGNATURE_LENGTH } from "@/lib/sanitize-signature";


const app = new Hono()

  .get("/", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.draft_preference.findUnique({
      where: { user_id: userId },
      select: {
        enabled:true,
        draftPrompt: true,
        fontColor: true,
        fontSize: true,
        signature: true,
        timezone:true,
        senstivity:true,
        language:true
      },
    });

    if (!data) {
      return ctx.json(
        {
          data: {
            enabled:true,
            draftPrompt: null,
            fontColor: "#000000",
            fontSize: 14,
            signature: null,
            timezone: "UTC",
            senstivity: "",
            language: "english",
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
        enabled:z.boolean(),
        draftPrompt: z.string().max(1000).optional(),
        fontColor: z.string(),
        fontSize: z.number().min(8).max(72),
        signature: z.string().max(MAX_SIGNATURE_LENGTH).optional(),
        timezone:z.string(),
        senstivity:z.string().optional(),
        language:z.string().optional()
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to set draft preferences" }, 403);
      }

      const values = ctx.req.valid("json");

      // The signature is rich-editor HTML dropped raw into outgoing email bodies (lib/gmail.ts, lib/outlook.ts), so strip anything that isn't presentational markup first.
      const signature =
        values.signature !== undefined
          ? sanitizeSignatureHtml(values.signature)
          : undefined;

      const data = await db.draft_preference.upsert({
        where: { user_id: userId },
        update: {
          enabled:values.enabled,
          draftPrompt: values.draftPrompt,
          fontColor: values.fontColor,
          fontSize: values.fontSize,
          signature,
          timezone:values.timezone,
          senstivity:values.senstivity,
          language:values.language
        },
        create: {
          user_tokens: {
            connect: { clerk_user_id: userId },
          },
          enabled:values.enabled,
          draftPrompt: values.draftPrompt,
          fontColor: values.fontColor,
          fontSize: values.fontSize,
          signature,
          timezone:values.timezone,
          senstivity:values.senstivity,
          language:values.language
        },
      });

      if (!data) {
        return ctx.json({ error: "Error saving preferences" }, 500);
      }

      return ctx.json({ data }, 200);
    },
  );

export default app;
