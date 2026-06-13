import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { checkFeatureAccess } from "@/lib/tier-guard";
import { handleTelegramQueryGmail } from "@/lib/chat/gmail";
import { handleTelegramQueryOutlook } from "@/lib/chat/outlook";
import { consumeAttachment, getAttachment } from "@/lib/chat/attachment-store";

const querySchema = z.object({
  query: z.string().min(1).max(2000),
});

const app = new Hono()

  // POST /api/chat — send a query to the AI
  .post(
    "/",
    zValidator("json", querySchema),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const access = await checkFeatureAccess(userId);
      if (!access.allowed) {
        return ctx.json(
          {
            error: "Upgrade required",
            message: "AI Email Chat is available on Pro and Max plans.",
            tier: access.tier,
          },
          402,
        );
      }

      const { query } = ctx.req.valid("json");

      const userTokens = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if (!userTokens) {
        return ctx.json({ error: "User not found" }, 404);
      }

      const isGmail = userTokens.is_gmail;

      try {
        const attachmentKeys: string[] = [];
        const response = isGmail
          ? await handleTelegramQueryGmail(query, userId, "api", attachmentKeys)
          : await handleTelegramQueryOutlook(query, userId, "api", attachmentKeys);

        const attachments = attachmentKeys
          .map((key) => {
            const meta = getAttachment(key);
            if (!meta) return null;
            return { key, filename: meta.filename, mimeType: meta.mimeType };
          })
          .filter(Boolean) as { key: string; filename: string; mimeType: string }[];

        return ctx.json({ response, attachments }, 200);
      } catch (error) {
        console.error(
          `[chat/api] ${isGmail ? "gmail" : "outlook"} error:`,
          error,
        );
        return ctx.json(
          {
            error: "Chat processing failed",
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
          500,
        );
      }
    },
  )

  // GET /api/chat/attachment/:key — download a stored attachment
  .get("/attachment/:key", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const { key } = ctx.req.param();
    const attachment = consumeAttachment(key);

    if (!attachment) {
      return ctx.json({ error: "Attachment not found or expired" }, 404);
    }

    const blob = new Blob([new Uint8Array(attachment.data)], { type: attachment.mimeType })
    return new Response(blob, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachment.filename}"`,
        "Content-Length": blob.size.toString(),
      },
    });
  });

export default app;
