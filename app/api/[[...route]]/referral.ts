import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { getOrCreateReferralCode, isReferralRedeemable, MAX_REFERRAL_MONTHS } from "@/lib/referral";

// cursor = id of the last row from the previous page
const listReferralsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

const app = new Hono()
  // GET /api/referral/code: get-or-create the caller's shareable code
  .get("/code", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const code = await getOrCreateReferralCode(userId);

    const userTokens = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { referral_months_granted: true },
    });
    const monthsGranted = userTokens?.referral_months_granted ?? 0;

    return ctx.json(
      {
        code,
        link: `${process.env.NEXT_PUBLIC_API_URL!}/?ref=${code}`,
        monthsGranted,
        monthsRemaining: Math.max(0, MAX_REFERRAL_MONTHS - monthsGranted),
        monthsCap: MAX_REFERRAL_MONTHS,
      },
      200,
    );
  })

  // GET /api/referral/incoming: has this signed-in user been referred by
  // someone else? A read-only preview of checkout.ts's eligibility check (no
  // Referral row created) so onboarding can show the 14-day trial messaging
  // before checkout actually runs.
  .get("/incoming", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    // Same "first checkout ever" gate checkout.ts uses, so a returning or
    // churned user browsing onboarding again doesn't see a promise it won't honor.
    const priorPayment = await db.paymentHistory.findFirst({
      where: { clerkUserId: userId },
      select: { id: true },
    });
    if (priorPayment) return ctx.json({ referred: false }, 200);

    const refCode = getCookie(ctx, "nm_ref");
    const referred = await isReferralRedeemable(userId, refCode);
    return ctx.json({ referred }, 200);
  })

  // GET /api/referral/status: paginated list of the caller's sent referrals
  .get("/status", zValidator("query", listReferralsSchema), async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const { limit, cursor } = ctx.req.valid("query");

    // grab one extra row so we know if there's a next page
    const rows = await db.referral.findMany({
      where: { referrer_user_id: userId },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        created_at: true,
      },
    });

    const hasMore = rows.length > limit;
    const referrals = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? referrals[referrals.length - 1].id : null;

    return ctx.json({ referrals, nextCursor }, 200);
  });

export default app;
