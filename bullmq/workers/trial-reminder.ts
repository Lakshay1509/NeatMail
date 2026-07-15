import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getPlanFromProductId, getTierPrices, type BillingRegion } from "@/lib/tiers";
import { sendTrialReminderEmail } from "@/lib/resend";

// Each labelled email is treated as ~30s of manual triage saved.
const SECONDS_SAVED_PER_EMAIL = 30;
// States where "your trial ends tomorrow" no longer makes sense.
const TERMINAL_STATUSES = ["cancelled", "expired", "failed"];
const SENT_GUARD_TTL_SECONDS = 60 * 60 * 24 * 14;

interface TrialReminderJob {
  clerkUserId: string;
  subscriptionId: string;
  trialStartedAt: string;
  chargeAt: string;
}

const sentGuardKey = (subscriptionId: string) =>
  `trial-reminder:sent:${subscriptionId}`;

export async function processTrialReminder(job: Job<TrialReminderJob>) {
  const { clerkUserId, subscriptionId, trialStartedAt, chargeAt } = job.data;

  const sub = await db.subscription.findUnique({
    where: { dodoSubscriptionId: subscriptionId },
    select: {
      status: true,
      cancelAtNextBillingDate: true,
      customerEmail: true,
      customerName: true,
      currency: true,
      productId: true,
      metadata: true,
      nextBillingDate: true,
      paymentFrequencyInterval: true,
      paymentFrequencyCount: true,
      user_tokens: { select: { email: true, deleted_flag: true } },
    },
  });

  // State no longer matches the reminder — skip silently.
  if (!sub) return;
  if (sub.user_tokens?.deleted_flag) return;
  if (TERMINAL_STATUSES.includes(sub.status)) return;

  const to = sub.customerEmail || sub.user_tokens?.email || "";
  if (!to) return;

  // Will the card actually be charged at trial end? (auto-renew still on)
  const willCharge = sub.cancelAtNextBillingDate !== true;

  // Stats: emails labelled during the trial.
  const labelled = await db.email_tracked.count({
    where: {
      user_id: clerkUserId,
      created_at: { gte: new Date(trialStartedAt) },
    },
  });
  const timeSavedLabel = formatDuration(labelled * SECONDS_SAVED_PER_EMAIL);

  const charge = willCharge ? resolveCharge(sub) : null;
  const chargeDate = sub.nextBillingDate ?? new Date(chargeAt);
  const chargeDateLabel = chargeDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  // Guard against a retry resending after a successful send. Released on failure
  // so a genuine retry can still deliver.
  const fresh = await redis.set(
    sentGuardKey(subscriptionId),
    "1",
    "EX",
    SENT_GUARD_TTL_SECONDS,
    "NX",
  );
  if (fresh !== "OK") return;

  try {
    await sendTrialReminderEmail({
      to,
      name: sub.customerName ?? "",
      labelled,
      timeSavedLabel,
      willCharge,
      chargeAmountLabel: charge ? `${charge.symbol}${charge.amount}` : null,
      chargeDateLabel,
    });
  } catch (error) {
    await redis.del(sentGuardKey(subscriptionId));
    throw error; // surface to BullMQ for retry
  }
}

// Resolve the post-trial charge using our own pricing source of truth (the same
// numbers shown at checkout), avoiding any unit ambiguity in Dodo's raw amount.
function resolveCharge(sub: {
  productId: string;
  metadata: unknown;
  paymentFrequencyInterval: string;
  paymentFrequencyCount: number;
}): { amount: number; symbol: string } | null {
  const meta = (sub.metadata ?? {}) as { tier?: string; interval?: string };
  // Region from the product the customer actually bought. This worker has no request,
  // so there's no cf-ipcountry to read — and it must NOT come from sub.currency, which
  // DodoPay stores as "USD" for everyone, quoting Indian trials in dollars.
  const plan = getPlanFromProductId(sub.productId);
  const region: BillingRegion = plan?.region ?? "GLOBAL";
  const tier = plan?.tier ?? meta.tier;
  if (tier !== "PRO" && tier !== "MAX") return null;
  // Prefer the subscription's own cadence; fall back to checkout metadata.
  const isAnnual =
    sub.paymentFrequencyInterval === "Year" ||
    sub.paymentFrequencyCount >= 12 ||
    meta.interval === "annual";
  const prices = getTierPrices(region)[tier];
  return {
    amount: isAnnual ? prices.annual : prices.monthly,
    symbol: prices.symbol,
  };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
