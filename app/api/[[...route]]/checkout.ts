import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import DodoPayments from "dodopayments";
import {
  getProductId,
  getMailboxAddonId,
  getPlanFromProductId,
  getRegionFromCountry,
  intervalFromFrequency,
  effectiveSeatCap,
  tierAllowsExtraMailboxes,
  type BillingIntervalName,
  type Tier,
} from "@/lib/tiers";
import { getUserTier } from "@/lib/tier-guard";
import {
  isBillingOwner,
  getBillingTeamIds,
  getExtraMailboxes,
} from "@/lib/organization";
import { redeemReferralCookie } from "@/lib/referral";
import { resolveSubscriptionStatus } from "@/lib/subscription";

import { Hono } from "hono";
import { getCookie } from "hono/cookie";

export const getDodoPayments = () => {
  return new DodoPayments({
    environment:
      process.env.NODE_ENV === "production" ? "live_mode" : "test_mode",
    bearerToken: process.env.DODO_API!,
  });
};

// Sanity bound on the extra-mailbox add-on quantity; DodoPay may impose a lower
// per-add-on max, which it enforces on its side.
const MAX_EXTRA_MAILBOXES = 50;

// do_not_bill is a valid DodoPay proration mode but is missing from the SDK's
// union type, so call sites cast to it.
type ProrationBillingMode =
  | "prorated_immediately"
  | "difference_immediately"
  | "full_immediately"
  | "do_not_bill";

// on_payment_failure is a documented change-plan param that the SDK's types omit, so
// call sites cast. It has NO safe implicit default — DodoPay falls back to a
// business-level dashboard setting we can't see from here — so it must always be sent.
type OnPaymentFailure = "prevent_change" | "apply_change";

// Mailbox seat changes are billed IMMEDIATELY on both cadences, adding and removing.
// Per DodoPay's seat-billing table, prorated_immediately = "Charge for remaining days
// in cycle" when adding and "Credit for unused days" when removing — so the customer
// pays only for the seat-time they actually get, and no seat is ever free.
//
// Two consequences worth knowing, both accepted deliberately:
//  - The billing cycle "Resets to today" on every change (only do_not_bill preserves
//    it). A seat change therefore moves the customer's renewal anniversary.
//  - The charge is off-session, and DodoPay does NOT retry plan-change charges — hence
//    prevent_change below, which is what keeps money and seats in lockstep.
const MAILBOX_PRORATION_MODE = "prorated_immediately" as ProrationBillingMode;

// "Keep subscription on current plan until payment succeeds" — no payment, no seats.
// Never omit it: the implicit default is a business-level dashboard setting this code
// cannot see, and the other value (apply_change) grants the seat even if the charge
// fails, which is precisely the failure this feature must not have.
const MAILBOX_ON_PAYMENT_FAILURE = "prevent_change" as OnPaymentFailure;

/**
 * The add-on that matches a subscription's base plan. Both its currency and its billing
 * cycle must match the plan's, so BOTH are read off the plan's own product id. That is
 * the exact record of what the customer is actually on — and on this path the base plan
 * is NOT changing (both callers re-send subscription.productId), so the add-on must
 * match the product they already hold, not wherever they happen to be browsing from.
 * Cadence must come from the product too: annual can arrive as Year/1 or Month/12.
 *
 * Falls back to the caller's cf-ipcountry ONLY for a product id we don't recognise
 * (grandfathered, or created straight in the DodoPay dashboard). It must never fall back
 * to `currency`: DodoPay stores "USD" for every subscription, so that silently resolved
 * every customer — Indian ones included — to GLOBAL.
 */
/**
 * The new plan's full recurring charge (pre-tax, minor units) in the currency the
 * customer actually sees, plus that currency.
 *
 * DodoPay reports a preview in TWO currencies and they are not interchangeable:
 *  - `immediate_charge.summary` and every `line_item` are in the PRESENTMENT currency —
 *    what the customer is billed in (INR for an Indian plan).
 *  - `new_plan` is a Subscription, so `new_plan.recurring_pre_tax_amount` is in
 *    `new_plan.currency` — the SETTLEMENT currency, which DodoPay reports as "USD" for
 *    every subscription, Indian ones included.
 *
 * Rendering the second under the first's label is what made a ₹550/mo plan display as
 * "₹6.74/mo" (it was $6.74). So prefer the line items: their `unit_price` is the full
 * per-unit price and `proration_factor` is applied separately, so summing
 * unit_price × quantity across the subscription and add-on lines is the untouched
 * recurring total — already in presentment currency, directly comparable to the summary.
 *
 * Falls back to new_plan's own amount AND its own currency when there are no usable line
 * items. The pair is returned together precisely so the two can never drift apart again.
 */
function presentmentRecurring(preview: {
  immediate_charge?: {
    summary?: { currency?: string | null } | null;
    line_items?: Array<{ type: string; unit_price?: number; quantity?: number }> | null;
  } | null;
  new_plan?: { recurring_pre_tax_amount?: number; currency?: string | null } | null;
}): { amount: number; currency: string } {
  const lines = (preview.immediate_charge?.line_items ?? []).filter(
    (i) => i.type === "subscription" || i.type === "addon",
  );
  const presentmentCurrency = preview.immediate_charge?.summary?.currency;

  if (lines.length > 0 && presentmentCurrency) {
    return {
      amount: lines.reduce(
        (sum, i) => sum + (i.unit_price ?? 0) * (i.quantity ?? 0),
        0,
      ),
      currency: presentmentCurrency,
    };
  }

  return {
    amount: preview.new_plan?.recurring_pre_tax_amount ?? 0,
    currency: preview.new_plan?.currency ?? presentmentCurrency ?? "USD",
  };
}

function resolveMailboxAddon(
  sub: {
    productId: string;
    paymentFrequencyInterval: string;
    paymentFrequencyCount: number;
  },
  fallbackCountry: string,
): { addonId: string | null; interval: BillingIntervalName } {
  const plan = getPlanFromProductId(sub.productId);
  const region = plan?.region ?? getRegionFromCountry(fallbackCountry);
  const interval =
    plan?.interval ??
    intervalFromFrequency(sub.paymentFrequencyInterval, sub.paymentFrequencyCount);
  return { addonId: getMailboxAddonId(region, interval), interval };
}

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

      // A subscription that is active but scheduled to cancel must be RESUMED, never
      // duplicated. It falls through the guard above (hasActiveSub is false), and
      // checkout always creates a new subscription without checking for an existing
      // one — so without this the customer ends up with two active subscriptions
      // billing in parallel, and the second one's webhook reports zero paid seats
      // against the team the first one paid for.
      if (subscription?.status === "active" && isCancelling) {
        const resumed = await fetch(
          `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${process.env.DODO_API!}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ cancel_at_next_billing_date: false }),
          },
        );

        if (!resumed.ok) {
          console.error(
            "Failed to resume cancelling subscription %s: %s",
            subscription.dodoSubscriptionId,
            await resumed.text().catch(() => "<unreadable>"),
          );
          return ctx.json(
            { error: "Couldn't resume your subscription. Please try again." },
            502,
          );
        }

        // The subscription.updated webhook writes cancelAtNextBillingDate back.
        return ctx.json({ success: true, resumed: true }, 200);
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
      const seatCap = effectiveSeatCap(tier, await getExtraMailboxes(userId));
      if (memberCount > seatCap) {
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

      // Paid mailboxes are MAX-only, so they can't ride along to a tier that can't hold
      // them. Refuse rather than dropping them silently: the seats are paid for, and
      // cancelling them is the owner's call to make, not a side effect of a plan change.
      if (
        !tierAllowsExtraMailboxes(targetTier) &&
        subscription.extraMailboxes > 0
      ) {
        return ctx.json(
          {
            error: `Extra mailboxes are only available on MAX. Remove your ${subscription.extraMailboxes} extra mailbox${subscription.extraMailboxes === 1 ? "" : "es"} before switching to ${targetTier}.`,
            code: "MAILBOXES_NOT_ON_TARGET_TIER",
            extraMailboxes: subscription.extraMailboxes,
          },
          409,
        );
      }

      // Paid mailboxes carry across the plan change, so they count toward the
      // target's effective cap. Only the tier's included seats change here.
      const seatCap = effectiveSeatCap(targetTier, subscription.extraMailboxes);
      if (memberCount > seatCap) {
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

      // Carry paid mailbox seats across the plan change. The SDK drops any add-on not
      // re-sent ("Leaving this empty would remove any existing addons"), so an
      // unmodified changePlan would silently wipe the customer's mailboxes.
      //
      // Resolved against the TARGET interval, not the current one: an add-on's billing
      // cycle must match its subscription's, so a monthly→annual switch has to swap the
      // monthly add-on for the annual one. Re-sending the old id would attach a
      // cycle-mismatched add-on.
      //
      // Region comes from the same cf-ipcountry as productId above — the add-on must
      // match the product this very call is attaching. (It used to come from
      // subscription.currency, which is always "USD", so an Indian customer got the
      // INDIA product with a GLOBAL add-on bolted on.)
      let preservedAddons: { addon_id: string; quantity: number }[] = [];
      if (subscription.extraMailboxes > 0) {
        const addonId = getMailboxAddonId(getRegionFromCountry(country), interval);
        if (!addonId) {
          return ctx.json(
            { error: "Payment configuration error (mailbox add-on)" },
            500,
          );
        }
        preservedAddons = [
          { addon_id: addonId, quantity: subscription.extraMailboxes },
        ];
      }

      const dodopayments = getDodoPayments();
      await dodopayments.subscriptions.changePlan(subscription.dodoSubscriptionId, {
        product_id: productId,
        proration_billing_mode: "difference_immediately",
        quantity: 1,
        addons: preservedAddons,
      });

      // Mirror the committed change locally instead of waiting on the webhook. An
      // add-on-only /mailboxes call re-sends subscription.productId as its base plan,
      // so a stale row here would revert the customer to the plan they just left.
      // The webhook overwrites all of this with DodoPay's authoritative values; this
      // only closes the gap until it lands (and bumps updatedAt, arming the cooldown).
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          productId,
          paymentFrequencyInterval: interval === "annual" ? "Year" : "Month",
          paymentFrequencyCount: 1,
        },
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

      // Mirror /changePlan's refusal, or the dialog quotes a change the commit path
      // won't make.
      if (
        !tierAllowsExtraMailboxes(targetTier) &&
        subscription.extraMailboxes > 0
      ) {
        return ctx.json(
          {
            error: `Extra mailboxes are only available on MAX. Remove your ${subscription.extraMailboxes} extra mailbox${subscription.extraMailboxes === 1 ? "" : "es"} before switching to ${targetTier}.`,
            code: "MAILBOXES_NOT_ON_TARGET_TIER",
            extraMailboxes: subscription.extraMailboxes,
          },
          409,
        );
      }

      const country = ctx.req.header("cf-ipcountry") ?? "";
      const productId = getProductId(targetTier, country, interval);

      if (!productId) {
        return ctx.json({ error: "Product not configured" }, 500);
      }

      // Mirror the changePlan call exactly — same target interval AND same cf-ipcountry
      // region for the add-on — so the previewed charge matches what the real plan
      // change will bill.
      let preservedAddons: { addon_id: string; quantity: number }[] = [];
      if (subscription.extraMailboxes > 0) {
        const addonId = getMailboxAddonId(getRegionFromCountry(country), interval);
        if (!addonId) {
          return ctx.json(
            { error: "Payment configuration error (mailbox add-on)" },
            500,
          );
        }
        preservedAddons = [
          { addon_id: addonId, quantity: subscription.extraMailboxes },
        ];
      }

      const dodopayments = getDodoPayments();
      const preview = await dodopayments.subscriptions.previewChangePlan(
        subscription.dodoSubscriptionId,
        {
          product_id: productId,
          proration_billing_mode: "difference_immediately",
          quantity: 1,
          addons: preservedAddons,
        },
      );

      const s = preview.immediate_charge.summary;
      const p = preview.new_plan;
      const recurring = presentmentRecurring(preview);

      return ctx.json(
        {
          summary: {
            totalAmount: s.total_amount,
            customerCredits: s.customer_credits,
            settlementAmount: s.settlement_amount,
            /**
             * Currency of totalAmount/customerCredits — the PRESENTMENT currency. It was
             * previously taken from subscription.currency, which DodoPay stores as "USD"
             * for everyone, so an Indian customer's ₹ credit rendered as "USD".
             */
            currency: s.currency ?? recurring.currency,
          },
          newPlan: {
            recurringAmount: recurring.amount,
            currency: recurring.currency,
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

  // Set the absolute number of paid extra mailboxes on the current subscription.
  // Add-on-only change (base plan unchanged), prorated immediately. Removal is
  // blocked while the seats it would drop are still occupied.
  .post("/mailboxes", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      // Add-ons bill against the org's subscription; only the owner may change them.
      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Billing is managed by your organization admin" },
          403,
        );
      }

      const body = await ctx.req.json().catch(() => ({}));
      const count = body.count;
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        count > MAX_EXTRA_MAILBOXES
      ) {
        return ctx.json(
          { error: `Mailbox count must be a whole number between 0 and ${MAX_EXTRA_MAILBOXES}` },
          400,
        );
      }

      const subscription = await db.subscription.findFirst({
        where: { clerkUserId: userId, status: "active" },
      });

      if (!subscription) {
        return ctx.json(
          { error: "An active subscription is required to add mailboxes" },
          400,
        );
      }

      // Card trials report status:"active", so without this a trialist would reach the
      // immediate-charge path below. Per DodoPay's seat-billing table a proration mode
      // ENDS the trial — so adding a seat would silently cut their trial short and start
      // billing the plan. Blocking is the kind refusal.
      // resolveSubscriptionStatus owns the card-trial definition; don't re-derive it.
      if ((await resolveSubscriptionStatus(userId)).freeTrial) {
        return ctx.json(
          { error: "Extra mailboxes are available once your subscription starts." },
          400,
        );
      }

      // MAX-only add-on: PRO is a solo plan and doesn't sell seats. Only BUYING is
      // gated — a reduction stays open on every tier, so a subscription that reached a
      // non-MAX plan still holding add-ons (an out-of-band downgrade in the DodoPay
      // portal) can always stop paying for seats it can no longer use.
      const tier = await getUserTier(userId);
      if (!tierAllowsExtraMailboxes(tier) && count > subscription.extraMailboxes) {
        return ctx.json(
          {
            error: "Extra mailboxes are only available on the MAX plan. Upgrade to MAX to add teammates.",
            code: "MAILBOXES_NOT_ON_TIER",
          },
          403,
        );
      }

      if (count === subscription.extraMailboxes) {
        return ctx.json(
          {
            error: `You already have ${count} extra mailbox${count === 1 ? "" : "es"}.`,
          },
          409,
        );
      }

      // Mirror /changePlan's cooldown so rapid clicks can't fire overlapping prorated
      // charges. Every change now bills immediately, so this matters: updatedAt is
      // bumped by the plan_changed webhook the changePlan below triggers. DodoPay also
      // rejects a second change while one is pending (PendingPlanChangeExists), which
      // covers the window before that webhook lands.
      const cooldownSeconds = 30;
      if (Date.now() - subscription.updatedAt.getTime() < cooldownSeconds * 1000) {
        return ctx.json(
          { error: `Billing was recently changed. Please wait ${cooldownSeconds}s before changing again.` },
          429,
        );
      }

      // Block removal that would strip an occupied seat. Effective capacity after
      // the change is (tier's included seats + count); if that can't hold the
      // current headcount (members + still-open invites), refuse and make the owner
      // free up seats first. Increases never reach this branch.
      //
      // Skipped on a tier that can't hold paid seats: there the add-ons already grant
      // nothing (the members they'd cover are paused), so dropping them strips no live
      // seat — and refusing would trap the owner into paying for seats they can't use.
      if (count < subscription.extraMailboxes && tierAllowsExtraMailboxes(tier)) {
        const org = await db.organization.findUnique({
          where: { created_by: userId },
          select: { id: true },
        });
        let occupied = 0;
        if (org) {
          const [memberCount, pendingInvites] = await Promise.all([
            db.organizationMember.count({
              where: { organization_id: org.id, role: "MEMBER" },
            }),
            db.organizationInvite.count({
              where: {
                organization_id: org.id,
                used_at: null,
                expires_at: { gt: new Date() },
              },
            }),
          ]);
          occupied = memberCount + pendingInvites;
        }
        if (effectiveSeatCap(tier, count) < occupied) {
          return ctx.json(
            {
              error: `You have ${occupied} team seat${occupied === 1 ? "" : "s"} in use. Remove members or revoke pending invites before reducing to ${count} extra mailbox${count === 1 ? "" : "es"}.`,
              code: "MAILBOX_SEATS_IN_USE",
              occupied,
            },
            409,
          );
        }
      }

      const { addonId } = resolveMailboxAddon(
        subscription,
        ctx.req.header("cf-ipcountry") ?? "",
      );
      if (!addonId) {
        return ctx.json(
          { error: "Payment configuration error (mailbox add-on)" },
          500,
        );
      }

      const dodopayments = getDodoPayments();
      await dodopayments.subscriptions.changePlan(subscription.dodoSubscriptionId, {
        product_id: subscription.productId,
        proration_billing_mode: MAILBOX_PRORATION_MODE as "prorated_immediately",
        quantity: 1,
        addons: count > 0 ? [{ addon_id: addonId, quantity: count }] : [],
        on_payment_failure: MAILBOX_ON_PAYMENT_FAILURE,
      } as Parameters<typeof dodopayments.subscriptions.changePlan>[1]);

      // The subscription (plan_changed) webhook writes extraMailboxes back as the
      // source of truth; we don't mutate it here to avoid drift with DodoPay. Under
      // prevent_change that webhook only lands once the charge settles — which is the
      // point: the seat count in our DB can never run ahead of the money.
      return ctx.json({ success: true, count }, 200);
    } catch (error) {
      console.error("Update mailboxes error:", error);
      return ctx.json({ error: "Failed to update mailboxes" }, 500);
    }
  })

  // Preview the prorated charge for changing to `count` extra mailboxes, without
  // committing. Powers the confirm dialog.
  .post("/mailboxes/preview", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Billing is managed by your organization admin" },
          403,
        );
      }

      const body = await ctx.req.json().catch(() => ({}));
      const count = body.count;
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        count > MAX_EXTRA_MAILBOXES
      ) {
        return ctx.json(
          { error: `Mailbox count must be a whole number between 0 and ${MAX_EXTRA_MAILBOXES}` },
          400,
        );
      }

      const subscription = await db.subscription.findFirst({
        where: { clerkUserId: userId, status: "active" },
      });

      if (!subscription) {
        return ctx.json({ error: "No active subscription found" }, 400);
      }

      // Same MAX-only gate as POST /mailboxes — never quote a purchase the commit path
      // will refuse. Reductions stay previewable on every tier, for the same reason.
      const tier = await getUserTier(userId);
      if (!tierAllowsExtraMailboxes(tier) && count > subscription.extraMailboxes) {
        return ctx.json(
          {
            error: "Extra mailboxes are only available on the MAX plan. Upgrade to MAX to add teammates.",
            code: "MAILBOXES_NOT_ON_TIER",
          },
          403,
        );
      }

      const { addonId, interval } = resolveMailboxAddon(
        subscription,
        ctx.req.header("cf-ipcountry") ?? "",
      );
      if (!addonId) {
        return ctx.json(
          { error: "Payment configuration error (mailbox add-on)" },
          500,
        );
      }

      // Must mirror POST /mailboxes exactly — same mode, same cart — or the dialog
      // quotes a charge the commit path won't make.
      const dodopayments = getDodoPayments();
      const preview = await dodopayments.subscriptions.previewChangePlan(
        subscription.dodoSubscriptionId,
        {
          product_id: subscription.productId,
          proration_billing_mode: MAILBOX_PRORATION_MODE as "prorated_immediately",
          quantity: 1,
          addons: count > 0 ? [{ addon_id: addonId, quantity: count }] : [],
        },
      );

      const summary = preview.immediate_charge?.summary;
      const recurring = presentmentRecurring(preview);

      // summary.total_amount is DodoPay's own answer to "what would you charge for this
      // change", already net of customer_credits — which matter here, because
      // prorated_immediately re-prorates the WHOLE plan and credits the already-paid
      // term back. Summing line_items instead ignores that credit and can overstate the
      // charge several-fold. A removal nets to a credit, so this can be 0.
      return ctx.json(
        {
          count,
          currentCount: subscription.extraMailboxes,
          /** Currency of chargedNow/credits/tax — DodoPay's PRESENTMENT currency. */
          currency: summary?.currency ?? recurring.currency,
          /** Amount charged today. 0 on a removal, which credits instead. */
          chargedNow: summary?.total_amount ?? 0,
          /** Credit for unused seat-time, already netted off chargedNow. */
          credits: summary?.customer_credits ?? 0,
          tax: summary?.tax ?? 0,
          /** Next recurring charge, PRE-TAX, on the `annual` cadence below. */
          newRecurring: recurring.amount,
          /**
           * Currency of newRecurring ONLY. Separate from `currency` above because the
           * two can genuinely differ — see presentmentRecurring. Never format the
           * recurring with `currency`, or an Indian customer's $6.74 renders as ₹6.74.
           */
          recurringCurrency: recurring.currency,
          annual: interval === "annual",
          nextBillingDate: preview.new_plan?.next_billing_date ?? null,
        },
        200,
      );
    } catch (error) {
      console.error("Preview mailboxes error:", error);
      return ctx.json({ error: "Failed to preview mailbox change" }, 500);
    }
  })

export default app;
