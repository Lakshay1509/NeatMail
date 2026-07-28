import { db } from "./prisma";
import { getBillingOwnerId } from "./organization";
import type { Tier } from "./tiers";

export interface SubscriptionStatus {
  success: boolean;
  subscribed: boolean;
  tier: Tier;
  status?: string;
  price?: number;
  /**
   * The subscription's billing currency. Prices must be shown from THIS, not from
   * the viewer's geo — a customer billed in INR who opens the page from abroad would
   * otherwise be quoted USD while still being charged INR.
   */
  currency?: string;
  interval?: "monthly" | "annual";
  next_billing_date?: Date | null;
  cancel_at_next_billing_date?: boolean | null;
  freeTrial: boolean;
  /** Paid extra-mailbox add-on seats on the owner's subscription (0 when none). */
  extraMailboxes: number;
  /** A payment is mid-flight (DodoPay "processing") — plan will update once it settles. */
  paymentProcessing: boolean;
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

  // Every read here is projected down to the columns actually used below.
  // PaymentHistory in particular carries a `metadata` Json blob straight from
  // the DodoPay webhook, so an unprojected findFirst pulls multiple KB per call
  // — and this function runs on hot paths (see the /archive-messages cron).
  // The two payment probes are pure existence checks, hence `select: { id }`.
  const [data, freeTrial, owner, processingPayment, zero_payment, paid_charge] =
    await Promise.all([
      db.subscription.findFirst({
        where: { clerkUserId: ownerId },
        select: {
          cancelAtNextBillingDate: true,
          nextBillingDate: true,
          status: true,
          recurringAmount: true,
          currency: true,
          paymentFrequencyInterval: true,
          paymentFrequencyCount: true,
          extraMailboxes: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      db.free_trial.findUnique({
        where: { user_id: ownerId },
        select: { status: true, expires_at: true },
      }),
      db.user_tokens.findUnique({
        where: { clerk_user_id: ownerId },
        select: { tier: true },
      }),
      db.paymentHistory.findFirst({
        where: { clerkUserId: ownerId, status: "processing" },
        select: { id: true },
      }),
      db.paymentHistory.findFirst({
        where: { clerkUserId: ownerId, amount: 0, status: "succeeded" },
        select: { id: true },
      }),
      // A real post-trial charge; once present, the card trial has converted to paid.
      db.paymentHistory.findFirst({
        where: { clerkUserId: ownerId, amount: { gt: 0 }, status: "succeeded" },
        select: { id: true },
      }),
    ]);

  const paymentProcessing = !!processingPayment;

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
        extraMailboxes: 0,
        paymentProcessing,
      };
    }
    return {
      success: false,
      subscribed: false,
      tier,
      freeTrial: false,
      extraMailboxes: 0,
      paymentProcessing,
    };
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
      extraMailboxes: data.extraMailboxes ?? 0,
      paymentProcessing,
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
    currency: data.currency,
    interval: isAnnual ? "annual" : "monthly",
    next_billing_date: data.nextBillingDate,
    cancel_at_next_billing_date: data.cancelAtNextBillingDate,
    freeTrial: paidFreeTrial,
    extraMailboxes: data.extraMailboxes ?? 0,
    paymentProcessing,
  };
}
