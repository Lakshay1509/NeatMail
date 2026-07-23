import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { db } from "@/lib/prisma";
import { ensureResolvedTag } from "@/lib/tags";
import { checkFeatureAccess } from "@/lib/tier-guard";

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
        trackPromises: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const { userId } = await auth();
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const body = c.req.valid("json");

      // Promise tracking ("they owe me") is a paid feature, matching follow-ups
      // (Pro or Max). Enabling it on FREE is rejected; turning it off is always
      // allowed. Usage is metered against the shared follow-up allowance.
      if (body.trackPromises === true) {
        const access = await checkFeatureAccess(userId);
        if (!access.allowed) {
          return c.json(
            { error: access.reason ?? "Promise tracking requires a paid plan." },
            403,
          );
        }
      }

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
            track_promises: body.trackPromises ?? false,
          },
          update: {
            enabled: body.enabled,
            ai_drafts: body.aiDrafts,
            days: body.days,
            ...(body.skipEmails !== undefined && {
              skip_emails: normalize(body.skipEmails),
            }),
            ...(body.trackPromises !== undefined && {
              track_promises: body.trackPromises,
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
