import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { db } from "@/lib/prisma";
import { ensureResolvedTag } from "@/lib/tags";

const app = new Hono()
  .get("/preferences", async (c) => {
    const { userId } = await auth();
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const pref = await db.follow_up_preference.findUnique({
      where: { user_id: userId },
    });

    return c.json({ preference: pref ?? null });
  })
  .post(
    "/preferences",
    zValidator(
      "json",
      z.object({
        enabled: z.boolean(),
        aiDrafts: z.boolean(),
        days: z.number().int().min(1).max(30),
        skipEmails: z.string().optional(),
      }),
    ),
    async (c) => {
      const { userId } = await auth();
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const body = c.req.valid("json");

      const normalize = (val: string) =>
        val
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(",");

      const pref = await db.$transaction(async (tx) => {
        const p = await tx.follow_up_preference.upsert({
          where: { user_id: userId },
          create: {
            user_id: userId,
            enabled: body.enabled,
            ai_drafts: body.aiDrafts,
            days: body.days,
            skip_emails: normalize(body.skipEmails ?? ""),
          },
          update: {
            enabled: body.enabled,
            ai_drafts: body.aiDrafts,
            days: body.days,
            ...(body.skipEmails !== undefined && {
              skip_emails: normalize(body.skipEmails),
            }),
          },
        });

        // Follow-ups rely on the "Resolved" category to stop nagging closed
        // threads. Guarantee the tag exists whenever follow-ups are enabled.
        if (body.enabled) {
          await ensureResolvedTag(tx, userId);
        }

        return p;
      });

      return c.json({ preference: pref });
    },
  );

export default app;
