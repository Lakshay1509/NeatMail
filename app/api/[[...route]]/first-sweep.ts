import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { db } from "@/lib/prisma";
import { getUserTier } from "@/lib/tier-guard";
import { firstSweepQueue } from "@/lib/queue";
import { previewFirstRunSweep, SWEEP_BUCKETS } from "@/lib/first-run-sweep";

const BUCKET_KEYS = SWEEP_BUCKETS.map((b) => b.key) as [string, ...string[]];

const app = new Hono()
  // Powers the dashboard banner. Cheap (one messages.list per bucket, no bodies,
  // no AI). Returns eligible=false once the user has run their first sweep, or if
  // they're not a Gmail user (the buckets are Gmail categories).
  .get("/preview", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const token = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true, first_sweep_at: true, deleted_flag: true },
    });

    const alreadySwept = !!token?.first_sweep_at;
    const isGmail = token?.is_gmail ?? false;

    // Short-circuit without hitting Gmail when there's nothing to offer.
    if (!token || token.deleted_flag || !isGmail || alreadySwept) {
      return ctx.json(
        { eligible: false, alreadySwept, isGmail, total: 0, buckets: [] },
        200,
      );
    }

    try {
      const { total, buckets } = await previewFirstRunSweep(userId);
      return ctx.json(
        { eligible: total > 0, alreadySwept, isGmail, total, buckets },
        200,
      );
    } catch (err) {
      console.error("[first-sweep] preview error:", err);
      // Don't surface a scary error on the dashboard — just don't show the banner.
      return ctx.json(
        { eligible: false, alreadySwept, isGmail, total: 0, buckets: [] },
        200,
      );
    }
  })

  // The Kaboom. Enqueues the archive (kept off the request path so a huge backlog
  // can't time out the call) and stamps first_sweep_at now so the banner hides
  // immediately. The worker re-checks tier/subscription before touching mail.
  .post(
    "/run",
    zValidator(
      "json",
      z
        .object({
          buckets: z.array(z.enum(BUCKET_KEYS)).min(1).optional(),
        })
        .optional(),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to clear your inbox" }, 403);
      }

      const token = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true, first_sweep_at: true },
      });

      if (!token?.is_gmail) {
        return ctx.json({ error: "The inbox sweep is Gmail-only for now" }, 400);
      }
      if (token.first_sweep_at) {
        // Idempotent: already done, don't re-sweep.
        return ctx.json({ started: false, alreadySwept: true }, 200);
      }

      const body = ctx.req.valid("json");

      // Optimistic stamp: hides the banner right away. The worker sets the final
      // count; if the job never runs the mail simply stays put (nothing deleted).
      await db.user_tokens.update({
        where: { clerk_user_id: userId },
        data: { first_sweep_at: new Date() },
      });

      try {
        await firstSweepQueue.add(
          "first-sweep",
          { userId, action: "run", buckets: body?.buckets },
          // Stable jobId dedupes a double-click. No ":" — BullMQ forbids it in
          // custom ids (it's the Redis key delimiter).
          { jobId: `first-sweep-run-${userId}` },
        );
      } catch (err) {
        console.error("[first-sweep] enqueue failed:", err);
        // Roll back the stamp so the user can retry.
        await db.user_tokens.update({
          where: { clerk_user_id: userId },
          data: { first_sweep_at: null },
        });
        return ctx.json({ error: "Couldn't start the sweep. Try again." }, 500);
      }

      return ctx.json({ started: true }, 200);
    },
  )

  // Puts everything the sweep archived back in the inbox and clears the stamp so
  // the banner returns. Backs the "Undo" affordance.
  .post("/undo", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      await firstSweepQueue.add(
        "first-sweep",
        { userId, action: "undo" },
        { jobId: `first-sweep-undo-${userId}` },
      );
    } catch (err) {
      console.error("[first-sweep] undo enqueue failed:", err);
      return ctx.json({ error: "Couldn't undo. Try again." }, 500);
    }

    return ctx.json({ started: true }, 200);
  });

export default app;
