import {
  DisputePayload,
  PaymentPayload,
  RefundPayload,
  SubscriptionPayload,
} from "@/types/dodo";
import { db } from "./prisma";
import { activateWatch, deactivateWatch, OAuthError } from "./gmail";
import {
  createOutlookSubscription,
  deleteOutlookSubscription,
} from "./outlook";
import { activeFolder, getUserIsGmail } from "./supabase";
import {
  sendSubExpiredEmail,
  sendSeatCapAlertEmail,
  sendMailboxRevokedEmail,
  sendRefundWithSeatsEmail,
} from "./resend";
import { getDodoPayments } from "@/app/api/[[...route]]/checkout";
import {
  getTierFromProductId,
  intervalFromFrequency,
  sumMailboxAddons,
  effectiveSeatCap,
  type Tier,
} from "./tiers";
import { getBillingTeamIds, isBillingOwner } from "./organization";

export async function addSubscriptiontoDb(payload: SubscriptionPayload) {
  try {
    const data = payload.data;

    // Paid extra-mailbox seats live in the add-on cart; the webhook is the source
    // of truth, so the count self-heals after dashboard/portal edits too. null means
    // the cart is uninterpretable (add-on id unconfigured/rotated, or addons absent)
    // — we then leave the stored count untouched rather than write a destructive 0.
    const extraMailboxes = sumMailboxAddons(
      data.addons,
      data.currency,
      intervalFromFrequency(
        data.payment_frequency_interval,
        data.payment_frequency_count,
      ),
    );
    if (extraMailboxes === null) {
      console.error(
        "Mailbox add-on cart uninterpretable for subscription %s (currency %s, %d add-on(s)) — preserving stored extraMailboxes and skipping seat-cap enforcement. Check DODO_ADDON_MAILBOX_{MONTHLY,ANNUAL}_{INDIA,GLOBAL} on this deploy; if an add-on id was rotated, the retired id must stay in the comma-separated list.",
        data.subscription_id,
        data.currency,
        data.addons?.length ?? 0,
      );
    }

    // Step 1: Handle database operations in transaction
    const subscription = await db.$transaction(async (tx) => {
      const sub = await tx.subscription.upsert({
        where: { dodoSubscriptionId: data.subscription_id },
        update: {
          status: data.status,
          customerEmail: data.customer.email,
          // Keep the product current: a tier change (or portal switch) keeps the
          // same subscription_id, so without this the stored product goes stale and
          // an add-on-only changePlan would revert the plan. data.product_id is
          // authoritative and preserves the customer's actual (grandfathered) product.
          productId: data.product_id,
          currency: data.currency,
          recurringAmount: data.recurring_pre_tax_amount,
          quantity: data.quantity,
          // Omitted when null so the stored count survives an uninterpretable cart.
          ...(extraMailboxes !== null && { extraMailboxes }),
          paymentFrequencyInterval: data.payment_frequency_interval,
          paymentFrequencyCount: data.payment_frequency_count,
          nextBillingDate: new Date(data.next_billing_date),
          previousBillingDate: new Date(data.previous_billing_date),
          cancelAtNextBillingDate: data.cancel_at_next_billing_date,
          metadata: data.metadata || {},
        },
        create: {
          user_tokens: {
            connect: { clerk_user_id: data.metadata?.clerk_user_id },
          },
          dodoSubscriptionId: data.subscription_id,
          dodoCustomerId: data.customer.customer_id,
          customerEmail: data.customer.email,
          status: data.status,
          productId: data.product_id,
          currency: data.currency,
          recurringAmount: data.recurring_pre_tax_amount,
          quantity: data.quantity,
          // Null falls through to the column default (0). Safe on create: a brand-new
          // subscription has no members to evict, and the next interpretable webhook
          // corrects the count.
          ...(extraMailboxes !== null && { extraMailboxes }),
          paymentFrequencyInterval: data.payment_frequency_interval,
          paymentFrequencyCount: data.payment_frequency_count,
          nextBillingDate: new Date(data.next_billing_date),
          previousBillingDate: new Date(data.previous_billing_date),
          cancelAtNextBillingDate: data.cancel_at_next_billing_date,
          metadata: data.metadata || {},
        },
      });

      await tx.paymentHistory.updateMany({
        where: {
          dodoSubscriptionId: data.subscription_id,
          subscriptionId: null,
        },
        data: {
          subscriptionId: sub!.id,
        },
      });

      return sub;
    });

    // Step 2: Handle watch operations & tier updates outside transaction
    const clerkUserId = data.metadata?.clerk_user_id;
    const metadata = data.metadata as { clerk_user_id?: string; tier?: string } | undefined;

    if (data.status === "active") {
      const tier = getTierFromProductId(data.product_id)
        ?? (metadata?.tier as "PRO" | "MAX" | undefined)
        ?? "MAX";

      // Enforce seat cap before activating: an out-of-band downgrade (DodoPay
      // portal) or cancel/re-subscribe can leave more members than the tier +
      // paid mailboxes allow. checkout.ts blocks this in-app; this is the safety
      // net for already-charged webhooks, and must run before the fan-out below.
      await enforceSeatCap(clerkUserId, tier, extraMailboxes);

      // Admin's payment covers the whole team: activate watch and set tier for
      // owner + every member. handleWatchActivation swallows its own errors, so
      // one broken mailbox can't block the rest.
      const targets = await getBillingTeamIds(clerkUserId);

      // Skip re-arming watch for paused members (seat + tier stay, watch stays
      // stopped) and users flagged for deletion (ingest already skips them;
      // re-arming would just burn watch quota on a doomed mailbox). Owners have
      // no member row so the paused query excludes them; the deletion query covers them.
      const [pausedMembers, deletingUsers] = await Promise.all([
        db.organizationMember.findMany({
          where: { user_id: { in: targets }, active: false },
          select: { user_id: true },
        }),
        db.user_tokens.findMany({
          where: { clerk_user_id: { in: targets }, deleted_flag: true },
          select: { clerk_user_id: true },
        }),
      ]);
      const skipIds = new Set<string>([
        ...pausedMembers.map((m) => m.user_id),
        ...deletingUsers.map((u) => u.clerk_user_id),
      ]);

      for (const memberId of targets) {
        if (skipIds.has(memberId)) continue;
        await handleWatchActivation(memberId);
      }

      // Materialize tier onto every member, including paused ones (pause stops
      // the watch, not the plan), so tier-column readers like the free-tier
      // reaper cron stay correct without resolving the admin.
      await db.user_tokens.updateMany({
        where: { clerk_user_id: { in: targets } },
        data: { tier },
      });
    }

    if (
      clerkUserId &&
      (data.status === "expired" ||
        data.status === "cancelled" ||
        data.status === "failed" ||
        data.status === "on_hold" ||
        data.status === "pending")
    ) {
      // A member's own cancelled subscription can still emit a late webhook after
      // they've joined an org. They no longer own billing (coverage is inherited
      // from the admin), so tearing down here would wrongly strip a covered
      // member. Only tear down when the subject actually owns billing.
      const isOwner = await isBillingOwner(clerkUserId);

      const otherActive = await db.subscription.findFirst({
        where: {
          clerkUserId,
          status: "active",
          dodoSubscriptionId: { not: data.subscription_id },
        },
      });

      if (isOwner && !otherActive) {
        // Org no longer paid: deactivate watch and downgrade tier for owner and
        // every member. handleWatchDeactivation never throws, so one member's
        // failure won't block the rest.
        const targets = await getBillingTeamIds(clerkUserId);

        for (const memberId of targets) {
          await handleWatchDeactivation(memberId);
        }
        await sendSubExpiredEmail(data.customer.email, data.customer.name);

        // The trial (if any) is the admin's and covers the whole team.
        const hasActiveTrial = await db.free_trial.findFirst({
          where: { user_id: clerkUserId, status: "ACTIVE", expires_at: { gt: new Date() } },
        });

        await db.user_tokens.updateMany({
          where: { clerk_user_id: { in: targets } },
          data: { tier: hasActiveTrial ? "MAX" : "FREE" },
        });
      }
    }

    return subscription;
  } catch (error) {
    console.error("Error adding subscription to db", error);
    throw error;
  }
}

/**
 * Strips every paid extra mailbox from a subscription after its money was taken back.
 *
 * Revoked with do_not_bill — "Seat removed, no credit". This is the one place a credit
 * would be wrong: the customer already has the cash via the chargeback, so crediting
 * the unused seat-time on top would pay them twice. do_not_bill also leaves the billing
 * date alone, which matters because we're touching a subscription mid-dispute.
 *
 * The resulting plan_changed webhook writes extraMailboxes back to 0, and enforceSeatCap
 * pauses whichever teammates that leaves over cap.
 *
 * Never throws — the webhook must still ack.
 */
async function revokePaidMailboxes(
  dodoPaymentId: string,
  reason: string,
): Promise<void> {
  try {
    const payment = await db.paymentHistory.findUnique({
      where: { dodoPaymentId },
      select: { subscription: true },
    });
    const sub = payment?.subscription;
    // No linked subscription, or nothing paid for — nothing to revoke.
    if (!sub || sub.extraMailboxes <= 0) return;

    console.warn(
      "[mailbox-revoke] %s for payment %s — stripping %d paid mailbox(es) from subscription %s",
      reason, dodoPaymentId, sub.extraMailboxes, sub.dodoSubscriptionId,
    );

    const dodopayments = getDodoPayments();
    await dodopayments.subscriptions.changePlan(sub.dodoSubscriptionId, {
      product_id: sub.productId,
      proration_billing_mode: "do_not_bill" as "prorated_immediately",
      quantity: 1,
      addons: [],
    });

    await sendMailboxRevokedEmail({
      ownerId: sub.clerkUserId,
      reason,
      revokedCount: sub.extraMailboxes,
      dodoPaymentId,
    });
  } catch (error) {
    // Money is gone and the seats are still attached — needs a human.
    console.error(
      "[mailbox-revoke] FAILED for payment %s (%s) — seats still active despite %s:",
      dodoPaymentId, reason, reason, error,
    );
  }
}

/**
 * A chargeback is the adversarial case: the customer pulled the money back themselves,
 * so the seats it bought go immediately. Refunds are handled differently (see
 * addRefundtoDb) because those are merchant-initiated — you meant to do that.
 */
export async function handleDisputeOpened(payload: DisputePayload): Promise<void> {
  await revokePaidMailboxes(payload.data?.payment_id, "chargeback opened");
}

/**
 * PAUSES members over the effective seat cap (see effectiveSeatCap — the tier's included
 * seats, plus paid extra mailboxes only on a tier that may hold them), newest-joined
 * first, so an out-of-band downgrade (DodoPay portal,
 * cancel/re-subscribe, dropped add-ons) can't leave a team using more seats than it
 * pays for. Paused members keep their row, seat and tier but lose service: the watch is
 * stopped, and addSubscriptiontoDb's fan-out already skips active:false members when
 * re-arming, so a pause survives later webhooks.
 *
 * Deliberately NOT detachMembersFromOrg. That is irreversible — it deletes the
 * membership, drops them to FREE and latches trial_used — while the count it acts on is
 * inferred from a webhook payload that can be stale, out-of-order, or unreadable. Any
 * of those reads as "0 paid seats", so eviction would silently destroy a PAYING
 * customer's team with no undo. Pausing protects the revenue just as well (no service
 * without payment) and costs one flag flip to reverse if the count was wrong.
 *
 * Skipped when extraMailboxes is null (cart uninterpretable) — an unknown count must
 * never be enforced as if it were zero. The operator is alerted either way; restoring a
 * wrongly-paused member is a human decision, not an automatic one.
 */
async function enforceSeatCap(
  ownerId: string | undefined,
  tier: Tier,
  extraMailboxes: number | null,
): Promise<void> {
  if (!ownerId) return;
  if (extraMailboxes === null) return;
  const seatCap = effectiveSeatCap(tier, extraMailboxes);

  const org = await db.organization.findFirst({
    where: { created_by: ownerId },
    select: {
      members: {
        where: { role: "MEMBER", active: true },
        orderBy: { created_at: "asc" },
        select: { id: true, user_id: true },
      },
    },
  });
  if (!org) return;

  // Keep the earliest-joined up to the cap; pause the rest.
  const excess = org.members.slice(seatCap);
  if (excess.length === 0) return;

  console.warn(
    "[seat-cap] owner=%s tier=%s cap=%d active-members=%d — pausing %d newest member(s)",
    ownerId, tier, seatCap, org.members.length, excess.length,
  );

  await db.organizationMember.updateMany({
    where: { id: { in: excess.map((m) => m.id) } },
    data: { active: false },
  });
  for (const member of excess) {
    await handleWatchDeactivation(member.user_id); // self-isolating, never throws
  }

  // Pausing is reversible but not self-reversing — nothing un-pauses automatically,
  // because we can't tell an over-cap pause from an admin's deliberate one.
  await sendSeatCapAlertEmail({
    ownerId,
    tier,
    seatCap,
    memberCount: org.members.length,
    pausedUserIds: excess.map((m) => m.user_id),
  });
}

// Returns true if the watch was armed, false otherwise. Self-isolating: never
// throws, and callers (webhook fan-out, join flow, member resume) rely on that.
// getUserIsGmail must stay inside the try since it throws when the user_tokens
// row is missing.
export async function handleWatchActivation(userId: string): Promise<boolean> {
  let isGmail = true;
  try {
    const getUserIsGmailData = await getUserIsGmail(userId);
    isGmail = getUserIsGmailData.isGmail;
    if (isGmail) {
      const response = await activateWatch(userId);

      if (response.success && response.userId) {
        await db.user_tokens.update({
          where: { clerk_user_id: response.userId },
          data: {
            watch_activated: true,
            last_history_id: response.history_id,
            updated_at: new Date(),
          },
        });
        return true;
      }
      return false;
    } else {
      const activeFolderData = await activeFolder(userId);

      const foldersData = activeFolderData
        .filter((folder) => folder.isActive === true)
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
        }));
      const outlookResponse = await createOutlookSubscription(
        userId,
        foldersData,
      );
      if (outlookResponse?.length) {
        await db.user_tokens.update({
          where: { clerk_user_id: userId },
          data: {
            outlook_id: outlookResponse.map(r => r.id).join(","),
            watch_activated: true,
            updated_at: new Date(),
          },
        });
        return true;
      }
      return false;
    }
  } catch (error) {
    if (isGmail) {
      console.error("Failed to activate Gmail watch:", error);
    } else {
      console.error("Failed to activate outlook watch", error);
    }
    return false;
  }
}

// A revoked/expired/missing OAuth token means the provider stop/delete call can
// never succeed. Checks all three error shapes: OAuthError, status-coded errors
// (401/403/400), and plain "reconnect" errors with no status code.
function isRevokedTokenError(error: any): boolean {
  if (error instanceof OAuthError) return true;

  const code = error?.status ?? error?.statusCode ?? error?.code;
  if (code === 401 || code === 403 || code === 400) return true;

  if (
    error?.errors?.some?.(
      (e: any) =>
        e.code === "oauth_token_retrieval_error" ||
        e.code === "oauth_missing_refresh_token",
    )
  ) {
    return true;
  }

  const message = String(error?.message ?? "");
  return /access token|reconnect|oauth|invalid_grant|token has expired|invalidauthenticationtoken/i.test(
    message,
  );
}

export async function handleWatchDeactivation(userId: string): Promise<void> {
  // Must never throw: account deletion and trial/subscription crons rely on
  // this being non-blocking.
  try {
    const isGmail = (await getUserIsGmail(userId)).isGmail;

    const clearWatchState = () =>
      db.user_tokens.update({
        where: { clerk_user_id: userId },
        data: isGmail
          ? { watch_activated: false, last_history_id: null, updated_at: new Date() }
          : { watch_activated: false, outlook_id: null, updated_at: new Date() },
      });

    try {
      if (isGmail) {
        await deactivateWatch(userId);
      } else {
        await deleteOutlookSubscription(userId);
      }

      await clearWatchState();
    } catch (error) {
      if (isRevokedTokenError(error)) {
        // OAuth revoked: provider stop/delete can never succeed. Watch lapses on
        // its own (Gmail ~7 days, Outlook at subscription expiry) and ingestion is
        // already gated by tier/deleted_flag, so clear our bookkeeping now instead
        // of stranding this row.
        console.warn(
          `[watch] OAuth revoked for ${userId} — provider deactivation impossible; clearing local watch state`,
        );
        await clearWatchState();
        return;
      }

      // Transient failure: leave watch_activated as-is so a later attempt can
      // retry deactivation.
      console.error("Failed to deactivate watch:", error);
    }
  } catch (error) {
    console.error("Failed to deactivate watch:", error);
  }
}

export async function addPaymenttoDb(payload: PaymentPayload, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  try {
    const data = payload.data;

    if (data.subscription_id) {
      const subscriptionData = await db.subscription.findUnique({
        where: { dodoSubscriptionId: data.subscription_id },
      });

      if (!subscriptionData && retryCount < MAX_RETRIES) {
        console.log(
          `Subscription not found, retrying in ${RETRY_DELAY_MS}ms (attempt ${
            retryCount + 1
          }/${MAX_RETRIES})`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return addPaymenttoDb(payload, retryCount + 1);
      }

      if (!subscriptionData) {
        console.error(
          `Subscription not found after ${MAX_RETRIES} retries for payment ${data.payment_id}`,
        );
        throw new Error(`Subscription ${data.subscription_id} not found`);
      }

      const existingPayment = await db.paymentHistory.findUnique({
        where: { dodoPaymentId: data.payment_id },
      });

      if (existingPayment && existingPayment.status === data.status) {
        console.log(
          `Payment ${data.payment_id} already processed with same status`,
        );
        return;
      }

      await db.$transaction(async (tx) => {
        await tx.paymentHistory.upsert({
          where: { dodoPaymentId: data.payment_id },
          update: {
            status: data.status,
            subscriptionId: subscriptionData.id,
            settlementAmount: data.settlement_amount,
            currency: data.currency,
            paymentType: data.payment_method_type ?? "",
            paymentMethod: data.payment_method,
            errorCode: data.error_code,
            errorMessage: data.error_message,
            cardLastFour: data.card_last_four,
            cardNetwork: data.card_network,
            cardType: data.card_type,
            invoiceId: data.invoice_id,
            checkoutSessionId: data.checkout_session_id,
            metadata: data.metadata,
          },
          create: {
            user_tokens: {
              connect: { clerk_user_id: data.metadata?.clerk_user_id },
            },
            subscription: {
              connect: { id: subscriptionData.id },
            },
            dodoPaymentId: data.payment_id,
            dodoSubscriptionId: data.subscription_id,
            invoiceId: data.invoice_id,
            checkoutSessionId: data.checkout_session_id,
            amount: data.total_amount,
            settlementAmount: data.settlement_amount,
            currency: data.currency,
            status: data.status,
            paymentType: data.payment_method_type ?? "",
            paymentMethod: data.payment_method,
            errorCode: data.error_code,
            errorMessage: data.error_message,
            cardLastFour: data.card_last_four,
            cardNetwork: data.card_network,
            cardType: data.card_type,
            metadata: data.metadata,
          },
        });
      });
    }
  } catch (error) {
    console.error("Error adding payment to db", error);
    throw error;
  }
}

export async function addRefundtoDb(payload: RefundPayload) {
  try {
    const data = payload.data;

    const payment = await db.paymentHistory.findUnique({
      where: { dodoPaymentId: data.payment_id },
    });

    // Don't throw: the route turns that into a 500, DodoPay redelivers, and it fails
    // identically forever. An unrecordable refund is worth an alert, not a retry loop.
    if (!payment) {
      console.error(
        "Refund %s references unknown payment %s — refund NOT recorded.",
        data.refund_id,
        data.payment_id,
      );
      return;
    }

    await db.$transaction(async (tx) => {
      await tx.refund.upsert({
        where: { dodoRefundId: data.refund_id },
        update: {
          amount: data.amount,
          currency: data.currency,
          status: data.status,
          reason: data.reason,
          isPartial: data.is_partial,
        },
        create: {
          user_tokens: {
            connect: { clerk_user_id: data.metadata.clerk_user_id },
          },
          payment: {
            connect: { id: payment.id },
          },
          dodoRefundId: data.refund_id,
          dodoPaymentId: data.payment_id,
          amount: data.amount,
          currency: data.currency,
          status: data.status,
          reason: data.reason,
          isPartial: data.is_partial,
        },
      });
    });

    // Deliberately does NOT auto-revoke seats, unlike a chargeback. A refund is
    // merchant-initiated — you meant to issue it — and we can't tell from the payload
    // whether it covered a seat purchase or was goodwill on a base charge. Stripping a
    // customer's paid seats because you refunded them a month would be the wrong
    // surprise. Alerted instead so you can decide; revoke by hand if it was a seat refund.
    if (data.status === "succeeded" && payment.subscriptionId) {
      const sub = await db.subscription.findUnique({
        where: { id: payment.subscriptionId },
        select: { clerkUserId: true, extraMailboxes: true },
      });
      if (sub && sub.extraMailboxes > 0) {
        await sendRefundWithSeatsEmail({
          ownerId: sub.clerkUserId,
          seatCount: sub.extraMailboxes,
          dodoPaymentId: data.payment_id,
          amount: data.amount,
          currency: data.currency,
          isPartial: data.is_partial,
        });
      }
    }
  } catch (error) {
    console.error("Error adding refund to db", error);
    throw error;
  }
}
