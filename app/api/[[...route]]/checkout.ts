import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import DodoPayments from "dodopayments";
import { getProductId, TIER_LIMITS, type Tier } from "@/lib/tiers";
import { getUserTier } from "@/lib/tier-guard";
import { isBillingOwner, getBillingTeamIds } from "@/lib/organization";
import { redeemReferralCookie } from "@/lib/referral";

import { Hono } from "hono";
import { getCookie } from "hono/cookie";

export const getDodoPayments = () => {
  return new DodoPayments({
    environment:
      process.env.NODE_ENV === "production" ? "live_mode" : "test_mode",
    bearerToken: process.env.DODO_API!,
  });
};

const app = new Hono()
  .post("/", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      // Only the billing owner may checkout; a member must never mint a second subscription under the org.
      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Billing is managed by your organization admin" },
          403,
        );
      }

      const body = await ctx.req.json().catch(() => ({}));
      const tier: Tier = body.tier === "PRO" || body.tier === "MAX" ? body.tier : "PRO";
      const interval: "monthly" | "annual" = body.interval === "annual" ? "annual" : "monthly";
      // Card required now via DodoPay; first charge after 7 days (bumped to 14 on valid referral redemption).
      let trialPeriodDays = body.trial === true ? 7 : 0;
      const isOnboarding = body.onboard === true;

      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
        },
        select: {
          status: true,
          cancelAtNextBillingDate: true,
          dodoSubscriptionId: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      const payment = await db.paymentHistory.findFirst({
        where: {
          clerkUserId: userId,
          status: "processing",
        },
      });

      const isCancelling = subscription?.cancelAtNextBillingDate === true;
      const hasActiveSub =
        subscription?.status === "active" && !isCancelling;

      if (
        hasActiveSub ||
        subscription?.status === "pending" ||
        payment
      ) {
        return ctx.json(
          { error: "You have an active subscription or a payment in process" },
          409,
        );
      }

      // Trial eligibility: block on a prior $0 succeeded payment (own past trial), or
      // trial_used (latched flag for MAX access inherited as a since-removed org member,
      // since the OrganizationMember row is gone after detach).
      if (trialPeriodDays > 0) {
        const [priorTrial, tokenRow] = await Promise.all([
          db.paymentHistory.findFirst({
            where: { clerkUserId: userId, amount: 0, status: "succeeded" },
            select: { id: true },
          }),
          db.user_tokens.findUnique({
            where: { clerk_user_id: userId },
            select: { trial_used: true },
          }),
        ]);
        if (priorTrial || tokenRow?.trial_used) {
          return ctx.json(
            { error: "You've already used your free trial." },
            409,
          );
        }
      }

      // Referral redemption requires no prior payment ever, regardless of whether a trial was requested.
      const priorPayment = await db.paymentHistory.findFirst({
        where: { clerkUserId: userId },
        select: { id: true },
      });

      if (!priorPayment) {
        const refCode = getCookie(ctx, "nm_ref");
        const referralRedeemed = await redeemReferralCookie(userId, refCode);
        if (referralRedeemed && trialPeriodDays > 0) {
          trialPeriodDays = 14;
        }
      }

      const user = await currentUser();
      const name = user?.fullName ?? "";
      const emailAddress = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "";
      const dodopayments = getDodoPayments();

      if (subscription?.status === "on_hold") {
        const response = await dodopayments.subscriptions.updatePaymentMethod(
          subscription.dodoSubscriptionId,
          {
            type: "new",
            return_url: `${process.env.NEXT_PUBLIC_API_URL!}`,
          },
        );

        if (response.payment_id) {
          console.log("Charge created:", response.payment_id);
          return ctx.json({ url: response.payment_link }, 200);
        }
      }

      // Seat cap: block subscribing to a plan that can't cover existing team members
      // (e.g. re-subscribing to PRO while a MAX teammate's row survives cancellation).
      // Webhook re-enforces this for out-of-band/portal changes.
      const ownedOrg = await db.organization.findUnique({
        where: { created_by: userId },
        select: { _count: { select: { members: true } } },
      });
      const memberCount = ownedOrg?._count.members ?? 0;
      if (memberCount > TIER_LIMITS[tier].maxTeamMembers) {
        return ctx.json(
          {
            error: `Your team has ${memberCount} member${memberCount === 1 ? "" : "s"}, which the ${tier} plan doesn't include. Remove ${memberCount === 1 ? "them" : "your members"} before switching to ${tier}.`,
            code: "TEAM_OVER_SEAT_CAP",
            memberCount,
          },
          409,
        );
      }

      const country = ctx.req.header("cf-ipcountry") ?? "";
      const productId = getProductId(tier, country, interval);

      if (!productId) {
        console.error(
          `Missing product ID for tier="${tier}" country="${country}" interval="${interval}"`,
        );
        return ctx.json({ error: "Payment configuration error" }, 500);
      }

      const checkout = await dodopayments.checkoutSessions.create({
        product_cart: [
          {
            product_id: productId,
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: trialPeriodDays,
        },
        customer: {
          email: emailAddress,
          name: name,
        },
        metadata: {
          clerk_user_id: userId,
          tier,
          interval,
        },
        return_url: isOnboarding
          ? `${process.env.NEXT_PUBLIC_API_URL!}/onboard-complete`
          : `${process.env.NEXT_PUBLIC_API_URL!}`,
      });

      return ctx.json({ url: checkout.checkout_url }, 200);
    } catch (error) {
      console.error("Checkout error:", error);
      return ctx.json({ error: "Failed to create checkout session" }, 500);
    }
  })

  .post("cancelSubscription", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      // Members can't cancel/renew org billing; the renew branch below would otherwise open a checkout for them.
      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Billing is managed by your organization admin" },
          403,
        );
      }

      const renewQuery = ctx.req.query("renew");

      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: { in: ["active", "on_hold"] },
        },
      });

      if (!subscription) {
        if (renewQuery === "false") {
          const tier = await getUserTier(userId);
          if (tier === "FREE") {
            return ctx.json({ error: "No subscription to renew" }, 400);
          }

          const country = ctx.req.header("cf-ipcountry") ?? "";
          const interval = "monthly" as const;
          const targetTier: Tier = tier;
          const productId = getProductId(targetTier, country, interval);

          if (!productId) {
            return ctx.json({ error: "Payment configuration error" }, 500);
          }

          const user = await currentUser();
          const dodopayments = getDodoPayments();
          const checkout = await dodopayments.checkoutSessions.create({
            product_cart: [{ product_id: productId, quantity: 1 }],
            subscription_data: { trial_period_days: 0 },
            customer: {
              email: user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "",
              name: user?.fullName ?? "",
            },
            metadata: {
              clerk_user_id: userId,
              tier: targetTier,
              interval,
            },
            return_url: `${process.env.NEXT_PUBLIC_API_URL!}`,
          });

          return ctx.json({ url: checkout.checkout_url, redirect: true }, 200);
        }

        return ctx.json(
          { error: "You do not have an active or on-hold subscription to cancel" },
          409,
        );
      }

      const renew = renewQuery === "true" ? true : false;

      const response = await fetch(
        `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.DODO_API!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cancel_at_next_billing_date: renew,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to cancel subscription");
      }

      const data = await response.json();

      return ctx.json({ success: true, data }, 200);
    } catch (error) {
      console.error("Cancel subscription error:", error);
      return ctx.json({ error: "Failed to cancel subscription" }, 500);
    }
  })

  .post("/changePlan", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      // Plan changes write user_tokens.tier, only the billing owner may do so.
      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Billing is managed by your organization admin" },
          403,
        );
      }

      const body = await ctx.req.json().catch(() => ({}));
      const targetTier: Tier = body.tier === "PRO" || body.tier === "MAX" ? body.tier : "PRO";
      const interval: "monthly" | "annual" = body.interval === "annual" ? "annual" : "monthly";

      const subscription = await db.subscription.findFirst({
        where: { clerkUserId: userId, status: "active" },
      });

      if (!subscription) {
        return ctx.json({ error: "No active subscription found" }, 400);
      }

      const currentTier = await getUserTier(userId);
      const currentInterval =
        subscription.paymentFrequencyInterval === "Year" ||
        subscription.paymentFrequencyCount >= 12
          ? "annual"
          : "monthly";

      if (currentTier === targetTier && currentInterval === interval) {
        return ctx.json(
          { error: `Already on ${targetTier} ${interval} plan` },
          409,
        );
      }

      const cooldownSeconds = 30;
      const lastUpdated = subscription.updatedAt.getTime();
      if (Date.now() - lastUpdated < cooldownSeconds * 1000) {
        return ctx.json(
          { error: `Plan was recently changed. Please wait ${cooldownSeconds}s before changing again.` },
          429,
        );
      }

      // Seat cap: block a downgrade that can't cover the current team, owner must remove
      // members first. Webhook re-enforces this for out-of-band downgrades (evicts excess).
      const ownedOrg = await db.organization.findUnique({
        where: { created_by: userId },
        select: { _count: { select: { members: true } } },
      });
      const memberCount = ownedOrg?._count.members ?? 0;
      if (memberCount > TIER_LIMITS[targetTier].maxTeamMembers) {
        return ctx.json(
          {
            error: `Your team has ${memberCount} member${memberCount === 1 ? "" : "s"}. Remove ${memberCount === 1 ? "them" : "enough members"} before switching to ${targetTier}.`,
            code: "TEAM_OVER_SEAT_CAP",
            memberCount,
          },
          409,
        );
      }

      const country = ctx.req.header("cf-ipcountry") ?? "";
      const productId = getProductId(targetTier, country, interval);

      if (!productId) {
        return ctx.json(
          { error: `No product configured for tier="${targetTier}" region="${country === "IN" ? "IN" : "GLOBAL"}"` },
          500,
        );
      }

      const dodopayments = getDodoPayments();
      await dodopayments.subscriptions.changePlan(subscription.dodoSubscriptionId, {
        product_id: productId,
        proration_billing_mode: "difference_immediately",
        quantity: 1,
      });

      // Propagate the new tier to the whole billing team so members' materialised tier
      // doesn't go stale; userId is guaranteed to be the billing owner by the guard above.
      const teamIds = await getBillingTeamIds(userId);
      await db.user_tokens.updateMany({
        where: { clerk_user_id: { in: teamIds } },
        data: { tier: targetTier },
      });

      return ctx.json({ success: true }, 200);
    } catch (error) {
      console.error("Change plan error:", error);
      return ctx.json({ error: "Failed to change plan" }, 500);
    }
  })

  .post("/preview", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const body = await ctx.req.json().catch(() => ({}));
      const targetTier: Tier = body.tier === "PRO" || body.tier === "MAX" ? body.tier : "PRO";
      const interval: "monthly" | "annual" = body.interval === "annual" ? "annual" : "monthly";

      const subscription = await db.subscription.findFirst({
        where: { clerkUserId: userId, status: "active" },
      });

      if (!subscription) {
        return ctx.json({ error: "No active subscription found" }, 400);
      }

      const country = ctx.req.header("cf-ipcountry") ?? "";
      const productId = getProductId(targetTier, country, interval);

      if (!productId) {
        return ctx.json({ error: "Product not configured" }, 500);
      }

      const dodopayments = getDodoPayments();
      const preview = await dodopayments.subscriptions.previewChangePlan(
        subscription.dodoSubscriptionId,
        {
          product_id: productId,
          proration_billing_mode: "difference_immediately",
          quantity: 1,
        },
      );

      const s = preview.immediate_charge.summary;
      const p = preview.new_plan;
      const dbCurrency = subscription.currency;

      return ctx.json(
        {
          summary: {
            totalAmount: s.total_amount,
            customerCredits: s.customer_credits,
            settlementAmount: s.settlement_amount,
          },
          newPlan: {
            recurringAmount: p.recurring_pre_tax_amount,
            currency: dbCurrency,
            nextBillingDate: p.next_billing_date,
            interval:
              p.payment_frequency_interval === "Year" ||
              p.payment_frequency_count >= 12
                ? "year"
                : "month",
          },
        },
        200,
      );
    } catch (error) {
      console.error("Preview plan change error:", error);
      return ctx.json({ error: "Failed to preview plan change" }, 500);
    }
  })

  .get("/invoice/:id", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const payment_id = ctx.req.param("id");

      if (!payment_id) {
        return ctx.json({ error: "No payment id in the params" }, 400);
      }

      const invoice_data = await db.paymentHistory.findUnique({
        where: { dodoPaymentId: payment_id },
      });

      if (!invoice_data) {
        return ctx.json({ error: "No invoice data" }, 500);
      }

      if (invoice_data.clerkUserId !== userId) {
        return ctx.json(
          { error: "Unauthorized user for the given invoice" },
          401,
        );
      }

      console.log("Fetching invoice for payment_id:", payment_id);

      const dodopayments = getDodoPayments();
      const payment = await dodopayments.invoices.payments.retrieve(payment_id);

      console.log("Payment response type:", typeof payment);
      console.log("Payment response:", payment);

      if (!payment) {
        return ctx.json({ error: "Error getting invoice" }, 500);
      }

      const buffer = Buffer.from(await payment.arrayBuffer());
      console.log("Buffer length:", buffer.length);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${payment_id}.pdf"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Invoice download error:", error);
      return ctx.json({ error: "Failed to download invoice" }, 500);
    }
  })

  .get("/portal", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const [data, paymentData] = await Promise.all([
        db.subscription.findFirst({
          where: { clerkUserId: userId },
          select: { dodoCustomerId: true },
        }),
        db.paymentHistory.findFirst({
          where: { clerkUserId: userId },
          include: {
            subscription: {
              select: { dodoCustomerId: true },
            },
          },
        }),
      ]);

      const customerId =
        data?.dodoCustomerId ??
        paymentData?.subscription?.dodoCustomerId ??
        null;

      if (!customerId) {
        return ctx.json({ data: "" }, 200);
      }

      const dodopayments = getDodoPayments();
      const customerPortalSession =
        await dodopayments.customers.customerPortal.create(customerId);

      return ctx.json({ data: customerPortalSession.link }, 200);
    } catch (error) {
      console.error("Error getting portal for customer", error);
      return ctx.json({ error: "Error getting portal for customer" }, 500);
    }
  })

export default app;
