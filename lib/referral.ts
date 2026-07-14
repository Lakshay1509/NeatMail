import { customAlphabet } from "nanoid";
import { addMonths } from "date-fns";
import { db } from "./prisma";
import { claimReferralReward, releaseReferralReward, withReferrerLock } from "./redis";
import { haveEverSharedTeam } from "./organization";
import { sendReferralRewardEmail } from "./resend";
import { getPostHogClient } from "./posthog-server";
import { getDodoPayments } from "@/app/api/[[...route]]/checkout";
import type { PaymentPayload } from "@/types/dodo";
import type { Referral } from "@/prisma/generated/prisma/client";

export const MAX_REFERRAL_MONTHS = 3;

// Matches the (looser) validation done in proxy.ts before the cookie is ever
// set. Kept as a separate copy there since proxy.ts runs in the edge runtime
// and must not import DB-touching code.
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6,10}$/;

const REFERRAL_CODE_LENGTH = 8;
// Excludes 0/O/1/I/L so codes are unambiguous when read aloud or hand-typed.
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_CODE_GENERATION_ATTEMPTS = 3;

const generateReferralCode = customAlphabet(REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH);

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Get-or-create the caller's shareable referral code. Safe under concurrent
// first-load races: the write is a conditional `updateMany`, not a plain
// check-then-insert, so two simultaneous callers can't clobber each other's
// code. The loser just reads back whatever the winner set.
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existing = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { referral_code: true },
  });
  if (existing?.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateReferralCode();
    try {
      const { count } = await db.user_tokens.updateMany({
        where: { clerk_user_id: userId, referral_code: null },
        data: { referral_code: candidate },
      });
      if (count === 1) return candidate;

      const current = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { referral_code: true },
      });
      if (current?.referral_code) return current.referral_code;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Candidate collided with another user's code; retry with a fresh one.
    }
  }

  throw new Error(
    `Failed to generate a unique referral code for ${userId} after ${MAX_CODE_GENERATION_ATTEMPTS} attempts`,
  );
}

// Shared by redeemReferralCookie and isReferralRedeemable so the "is this code
// usable" logic (format, existence, self-referral) can never diverge between
// the actual redemption and a caller merely previewing the outcome.
async function resolveReferrer(
  refereeUserId: string,
  rawCode: string | undefined | null,
): Promise<{ referrerId: string; normalizedCode: string } | null> {
  if (!rawCode) return null;

  const normalizedCode = rawCode.trim().toUpperCase();
  if (!REFERRAL_CODE_PATTERN.test(normalizedCode)) {
    console.log(`[referral] rejected malformed code cookie for user ${refereeUserId}`);
    return null;
  }

  const referrer = await db.user_tokens.findUnique({
    where: { referral_code: normalizedCode },
    select: { clerk_user_id: true },
  });
  if (!referrer) {
    console.log(`[referral] code ${normalizedCode} does not resolve to any user — skipping redemption`);
    return null;
  }
  if (referrer.clerk_user_id === refereeUserId) {
    console.log(`[referral] rejected self-referral attempt by user ${refereeUserId}`);
    return null;
  }

  // A teammate can't refer a teammate: a member gets premium for free via the
  // admin's plan, so rewarding either of them for the other is circular. Blocks
  // pairs who were EVER on the same team, so a member who leaves and later
  // subscribes still can't retroactively convert their ex-admin's referral.
  if (await haveEverSharedTeam(referrer.clerk_user_id, refereeUserId)) {
    console.log(
      `[referral] rejected teammate referral: ${referrer.clerk_user_id} and ${refereeUserId} were on the same team`,
    );
    return null;
  }

  return { referrerId: referrer.clerk_user_id, normalizedCode };
}

// A referee who starts checkout, abandons it (never completes the Dodo
// payment), and retries must not lose their bonus. The PENDING row from the
// first attempt is still a live, unconverted redemption, not a spent one.
// Only a REWARDED/CAPPED/REVOKED row means the redemption has actually been
// used up.
async function findExistingReferral(refereeUserId: string) {
  return db.referral.findUnique({
    where: { referee_user_id: refereeUserId },
    select: { status: true },
  });
}

// Read-only: would redeemReferralCookie succeed right now for this user+code?
// Used to preview eligibility (e.g. onboarding's "you've been referred"
// banner) without creating anything.
export async function isReferralRedeemable(
  refereeUserId: string,
  rawCode: string | undefined | null,
): Promise<boolean> {
  const existing = await findExistingReferral(refereeUserId);
  if (existing) return existing.status === "PENDING";

  const resolved = await resolveReferrer(refereeUserId, rawCode);
  return resolved !== null;
}

// Attempts to redeem a referral code for a brand-new checkout. Every
// rejection path (bad format, unknown code, self-referral, already redeemed)
// is silent by design: an invalid or expired code must never block or error
// the checkout, it just falls back to the normal flow. Returns whether the
// referee ends up with a usable Referral row, whether newly created or still
// PENDING from a prior attempt.
export async function redeemReferralCookie(
  refereeUserId: string,
  rawCode: string | undefined | null,
): Promise<boolean> {
  const existing = await findExistingReferral(refereeUserId);
  if (existing) return existing.status === "PENDING";

  const resolved = await resolveReferrer(refereeUserId, rawCode);
  if (!resolved) return false;

  try {
    await db.referral.create({
      data: {
        referrer_user_id: resolved.referrerId,
        referee_user_id: refereeUserId,
        referral_code: resolved.normalizedCode,
        status: "PENDING",
      },
    });
    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Lost a create race to a concurrent request; that request's row is
      // just as usable as ours would have been.
      const raced = await findExistingReferral(refereeUserId);
      return raced?.status === "PENDING";
    }
    throw error;
  }
}

// Detects a referred account's first real (non-trial) payment from a
// `payment.succeeded` webhook and, if eligible, grants the referrer a free
// month by pushing their subscription's next billing date forward.
// Best-effort and never throws: called from the webhook handler after the
// payment is already recorded, so it must never fail the webhook itself.
export async function maybeRewardReferral(payload: PaymentPayload): Promise<void> {
  const data = payload.data;
  if (data.total_amount === 0) return; // trial-start charge, not a conversion

  const refereeUserId = data.metadata?.clerk_user_id;
  if (!refereeUserId) return;

  try {
    // Matching on PENDING is what makes this idempotent across subscription
    // renewals: once this referral moves out of PENDING, later
    // payment.succeeded events for the same referee find nothing to act on.
    const referral = await db.referral.findFirst({
      where: { referee_user_id: refereeUserId, status: "PENDING" },
    });
    if (!referral) return;

    // Defense-in-depth for rows created before resolveReferrer's teammate guard
    // existed: never reward a referral between two users who were ever on the
    // same team. Revoke it so later payment.succeeded events skip it too.
    if (await haveEverSharedTeam(referral.referrer_user_id, refereeUserId)) {
      await db.referral.update({
        where: { id: referral.id },
        data: { status: "REVOKED" },
      });
      console.log(
        `[referral] revoked teammate referral ${referral.id}: referrer ${referral.referrer_user_id} and referee ${refereeUserId} were on the same team`,
      );
      return;
    }

    // Guards the (short) window where two deliveries of the same event could
    // both pass the PENDING check above concurrently.
    const claimed = await claimReferralReward(refereeUserId);
    if (!claimed) return;

    let reachedTerminalState = false;
    try {
      // Serialized per referrer: if a different friend of the same referrer
      // is converting at the same moment, this waits for that one to fully
      // finish (Dodo call + DB write) before reading next_billing_date, so
      // the two pushes compound instead of one clobbering the other.
      const result = await withReferrerLock(referral.referrer_user_id, () =>
        applyReferralReward(referral),
      );
      // null means the lock couldn't be acquired in time (another reward for
      // the same referrer is still in flight). Treat that exactly like "not
      // applied yet," not a failure. A later renewal payment.succeeded for
      // this referee, or a duplicate delivery, will retry it.
      reachedTerminalState = result ?? false;
    } finally {
      // Only hold the guard once the referral is REWARDED/CAPPED. Otherwise a
      // legitimate later retry (e.g. the referrer reactivating their
      // subscription) shouldn't be blocked by a stale claim.
      if (!reachedTerminalState) {
        await releaseReferralReward(refereeUserId).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[referral] Failed to process referral reward", error);
  }
}

async function applyReferralReward(referral: Referral): Promise<boolean> {
  const subscription = await db.subscription.findFirst({
    where: { clerkUserId: referral.referrer_user_id, status: "active" },
    orderBy: { updatedAt: "desc" },
  });

  // No active subscription, or one already scheduled to cancel, means there's
  // nothing to push forward. Don't burn a cap slot on a reward that can't
  // actually be applied, and don't un-defer a cancellation the referrer
  // explicitly asked for.
  if (!subscription || subscription.cancelAtNextBillingDate || !subscription.nextBillingDate) {
    console.log(
      `[referral] referral ${referral.id}: referrer ${referral.referrer_user_id} has no active, non-cancelling subscription — leaving PENDING`,
    );
    return false;
  }

  // DodoPay has no distinct "trialing" status: a subscription still inside
  // its own free trial already reads `status: "active"`, identical to a
  // paying one. Without this check, a referrer who has never paid could keep
  // pushing their own trial forward a month at a time by recruiting
  // referees, indefinitely, without ever being charged themselves.
  const hasRealPayment = await db.paymentHistory.findFirst({
    where: { clerkUserId: referral.referrer_user_id, amount: { gt: 0 }, status: "succeeded" },
    select: { id: true },
  });
  if (!hasRealPayment) {
    console.log(
      `[referral] referral ${referral.id}: referrer ${referral.referrer_user_id} has never made a real payment (still on trial) — leaving PENDING`,
    );
    return false;
  }

  // Atomic reservation: only one of any number of concurrently-converting
  // referees of this referrer can win the last slot under the 3-month cap.
  const reserved = await db.user_tokens.updateMany({
    where: { clerk_user_id: referral.referrer_user_id, referral_months_granted: { lt: MAX_REFERRAL_MONTHS } },
    data: { referral_months_granted: { increment: 1 } },
  });

  // Not flushed here: dodo-webhook.ts already awaits posthog.shutdown() once
  // at the end of the request, after this call returns.
  const posthog = getPostHogClient();

  if (reserved.count === 0) {
    await db.referral.update({ where: { id: referral.id }, data: { status: "CAPPED" } });
    posthog.capture({ distinctId: referral.referrer_user_id, event: "referral_capped" });
    return true;
  }

  try {
    // Always +1 calendar month regardless of monthly/annual plan, clamped to
    // the target month's last valid day and preserving time-of-day.
    const newNextBillingDate = addMonths(subscription.nextBillingDate, 1);
    const dodopayments = getDodoPayments();
    await dodopayments.subscriptions.update(subscription.dodoSubscriptionId, {
      next_billing_date: newNextBillingDate.toISOString(),
    });

    // Mirror the new date locally now rather than waiting for the next
    // subscription.updated webhook, so Billing.tsx doesn't show a stale date.
    await db.$transaction([
      db.subscription.update({ where: { id: subscription.id }, data: { nextBillingDate: newNextBillingDate } }),
      db.referral.update({
        where: { id: referral.id },
        data: { status: "REWARDED", reward_applied_at: new Date() },
      }),
    ]);

    const referrer = await db.user_tokens.findUnique({
      where: { clerk_user_id: referral.referrer_user_id },
      select: { email: true, referral_months_granted: true },
    });

    posthog.capture({
      distinctId: referral.referrer_user_id,
      event: "referral_rewarded",
      properties: { monthsGranted: referrer?.referral_months_granted },
    });

    if (referrer) {
      try {
        await sendReferralRewardEmail({
          to: referrer.email,
          monthsGranted: referrer.referral_months_granted,
          monthsCap: MAX_REFERRAL_MONTHS,
        });
      } catch (emailError) {
        console.error(`[referral] failed to send reward email for referral ${referral.id}`, emailError);
      }
    }

    return true;
  } catch (error) {
    // Compensate: give back the reserved slot so a failed grant never
    // silently eats into the referrer's cap. Referral stays PENDING for retry.
    await db.user_tokens.updateMany({
      where: { clerk_user_id: referral.referrer_user_id },
      data: { referral_months_granted: { decrement: 1 } },
    });
    console.error(`[referral] Failed to apply reward for referral ${referral.id}`, error);
    return false;
  }
}
