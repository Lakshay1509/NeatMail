import { PaymentPayload } from "@/types/dodo";
import { db } from "./prisma";
import { redis } from "./redis";
import { trialReminderQueue } from "./queue";

// Send the reminder 24h before the trial converts to a paid charge.
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
// Fallback if the subscription's nextBillingDate isn't available yet.
const FALLBACK_TRIAL_DAYS = 7;
// How long to hold the "already scheduled" guard. Comfortably longer than a trial.
const SCHEDULE_GUARD_TTL_SECONDS = 60 * 60 * 24 * 14;

const scheduleGuardKey = (subscriptionId: string) =>
  `trial-reminder:scheduled:${subscriptionId}`;

/**
 * Detects the start of a card-required free trial from a `payment.succeeded`
 * webhook and schedules a one-off BullMQ job to remind the user ~24h before the
 * first real charge.
 *
 * A trial-start payment is the user's first money event: amount 0 + succeeded,
 * with no prior succeeded payment greater than zero. Called from the
 * `payment.succeeded` handler AFTER the payment has been written to the DB
 * (the $0 row has amount 0 so it never matches the "prior paid" check).
 */
export async function maybeScheduleTrialReminder(payload: PaymentPayload) {
  const data = payload.data;
  const clerkUserId = data.metadata?.clerk_user_id;
  const subscriptionId = data.subscription_id;

  // Only the trial-start ($0) charge on a subscription qualifies.
  if (!clerkUserId || !subscriptionId) return;
  if (data.total_amount !== 0) return;

  // Scheduling the reminder must NEVER fail the payment webhook — recording the
  // payment is the critical path, this is best-effort.
  try {
    // Guard: must be the first money event — no prior succeeded payment > 0.
    const priorPaid = await db.paymentHistory.findFirst({
      where: {
        clerkUserId,
        amount: { gt: 0 },
        status: "succeeded",
      },
      select: { id: true },
    });
    if (priorPaid) return;

    // Idempotent scheduling: SET NX so webhook retries / duplicate deliveries
    // don't enqueue the reminder twice.
    const locked = await redis.set(
      scheduleGuardKey(subscriptionId),
      "1",
      "EX",
      SCHEDULE_GUARD_TTL_SECONDS,
      "NX",
    );
    if (locked !== "OK") return;

    try {
      // Anchor to the real charge date from the subscription row (created by the
      // subscription.created/active webhook, which `addPaymenttoDb` waits for).
      const sub = await db.subscription.findUnique({
        where: { dodoSubscriptionId: subscriptionId },
        select: { nextBillingDate: true },
      });

      const trialStartedAt = new Date(data.created_at);
      const chargeAt =
        sub?.nextBillingDate ??
        new Date(trialStartedAt.getTime() + FALLBACK_TRIAL_DAYS * 24 * 60 * 60 * 1000);

      // Fire 24h before the charge; if we're already inside that window, send asap.
      const delay = Math.max(0, chargeAt.getTime() - REMINDER_LEAD_MS - Date.now());

      await trialReminderQueue.add(
        "trial-charge-reminder",
        {
          clerkUserId,
          subscriptionId,
          trialStartedAt: trialStartedAt.toISOString(),
          chargeAt: chargeAt.toISOString(),
        },
        {
          delay,
          jobId: `trial-reminder-${subscriptionId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (innerError) {
      // Couldn't enqueue — release the guard so a safety net can reschedule.
      await redis.del(scheduleGuardKey(subscriptionId)).catch(() => {});
      throw innerError;
    }
  } catch (error) {
    console.error("Failed to schedule trial reminder", error);
  }
}
