import { db } from "./prisma";
import { getBillingOwnerId } from "./organization";
import type { Tier } from "./tiers";

export interface SubscriptionStatus {
  success: boolean;
  subscribed: boolean;
  tier: Tier;
  status?: string;
  price?: number;
  interval?: "monthly" | "annual";
  next_billing_date?: Date | null;
  cancel_at_next_billing_date?: boolean | null;
  freeTrial: boolean;
}

/**
 * Single source of truth for subscription status. Resolves the billing owner (org admin) first,
 * so a member's check reads the admin's subscription/trial data. Shared by the API route and
 * getUserSubscribed so trial/paid/card-trial branching can't drift between them.
 */
export async function resolveSubscriptionStatus(
  userId: string,
): Promise<SubscriptionStatus> {
  const ownerId = await getBillingOwnerId(userId);

  const [data, freeTrial, owner] = await Promise.all([
    db.subscription.findFirst({
      where: { clerkUserId: ownerId },
      select: {
        cancelAtNextBillingDate: true,
        nextBillingDate: true,
        status: true,
        recurringAmount: true,
        paymentFrequencyInterval: true,
        paymentFrequencyCount: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.free_trial.findUnique({ where: { user_id: ownerId } }),
    db.user_tokens.findUnique({
      where: { clerk_user_id: ownerId },
      select: { tier: true },
    }),
  ]);

  const zero_payment = await db.paymentHistory.findFirst({
    where: { clerkUserId: ownerId, amount: 0, status: "succeeded" },
    orderBy: { createdAt: "desc" },
  });

  // A real post-trial charge; once present, the card trial has converted to paid.
  const paid_charge = await db.paymentHistory.findFirst({
    where: { clerkUserId: ownerId, amount: { gt: 0 }, status: "succeeded" },
  });

  const tier = (owner?.tier as Tier) ?? "FREE";

  const hasActiveTrial =
    !!freeTrial &&
    freeTrial.status === "ACTIVE" &&
    freeTrial.expires_at > new Date();

  // Card trial: $0 charge recorded, subscription active, no real charge yet.
  // Flips false after the first paid charge.
  const paidFreeTrial =
    !!zero_payment && data?.status === "active" && !paid_charge;

  // No subscription row yet: covered only by a standalone trial (hasActiveTrial implies freeTrial is non-null).
  if (!data) {
    if (hasActiveTrial) {
      return {
        success: true,
        subscribed: true,
        tier,
        status: "trial",
        next_billing_date: freeTrial!.expires_at,
        cancel_at_next_billing_date: null,
        freeTrial: true,
      };
    }
    return { success: false, subscribed: false, tier, freeTrial: false };
  }

  // Subscription row exists but isn't active, yet a trial still covers them.
  if (data.status !== "active" && hasActiveTrial) {
    return {
      success: true,
      subscribed: true,
      tier,
      status: "trial",
      next_billing_date: freeTrial!.expires_at,
      cancel_at_next_billing_date: null,
      freeTrial: true,
    };
  }

  // Paid subscription (active, or inactive with no covering trial).
  const isAnnual =
    data.paymentFrequencyInterval === "Year" ||
    data.paymentFrequencyCount >= 12;

  return {
    success: true,
    subscribed: data.status === "active",
    tier,
    status: data.status,
    price: data.recurringAmount / 100,
    interval: isAnnual ? "annual" : "monthly",
    next_billing_date: data.nextBillingDate,
    cancel_at_next_billing_date: data.cancelAtNextBillingDate,
    freeTrial: paidFreeTrial,
  };
}
