

import { Hono } from "hono";
import { Webhook } from "standardwebhooks";
import {
  addPaymenttoDb,
  addRefundtoDb,
  addSubscriptiontoDb,
  handleDisputeOpened,
} from "@/lib/payement";
import { maybeScheduleTrialReminder } from "@/lib/trial-reminder";
import { maybeRewardReferral } from "@/lib/referral";
import { isDodoWebhookProcessed, markDodoWebhookProcessed, unmarkDodoWebhookProcessed } from "@/lib/redis";
import { getPostHogClient } from "@/lib/posthog-server";

const app = new Hono().post("/", async (ctx) => {
  let webhook_id = "";
  try {
    const WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      return ctx.json({ error: "Please add dodo webhook to .env" }, 400);
    }

    webhook_id = ctx.req.header("webhook-id")??"";
    
    const webhook_timestamp = ctx.req.header("webhook-timestamp");
    const webhook_signature = ctx.req.header("webhook-signature");

    if (!webhook_id || !webhook_timestamp || !webhook_signature) {
      return new Response("Missing webhook headers", { status: 400 });
    }

    if (await isDodoWebhookProcessed(webhook_id)) {
        return ctx.json({ success: true }, 200);
    }

    // Mark early to prevent duplicate concurrent processing.
    // Will be unmarked on any failure so retries (exponential backoff) can reprocess.
    await markDodoWebhookProcessed(webhook_id);

    const payload = await ctx.req.json();
    const body = JSON.stringify(payload);

    const webhook = new Webhook(WEBHOOK_SECRET);

    try {
      await webhook.verify(body, {
        "webhook-id": webhook_id,
        "webhook-signature": webhook_signature,
        "webhook-timestamp": webhook_timestamp,
      });
    } catch (err) {
      console.error("Webhook verification failed", err);
      await unmarkDodoWebhookProcessed(webhook_id);
      return ctx.json({ error: err }, 400);
    }

    const posthog = getPostHogClient();
    const clerkUserId = payload.data?.metadata?.clerk_user_id || payload.data?.clerkUserId || "";

    switch (payload.type) {
      case "subscription.created": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_created",
          properties: { tier: payload.data?.metadata?.tier, interval: payload.data?.metadata?.interval },
        });
        break;
      }

      case "subscription.cancelled": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_cancelled",
          properties: { tier: payload.data?.metadata?.tier },
        });
        break;
      }

      case "subscription.updated": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_updated",
          properties: { tier: payload.data?.metadata?.tier },
        });
        break;
      }
      
      // Fires on upgrade, downgrade, and add-on changes. This is the write-back
      // that makes extraMailboxes authoritative after a /mailboxes changePlan —
      // without it a paid mailbox never reaches the DB and the seat cap never grows.
      case "subscription.plan_changed": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_plan_changed",
          properties: {
            tier: payload.data?.metadata?.tier,
            product_id: payload.data?.product_id,
          },
        });
        break;
      }

      case "subscription.active": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_activated",
          properties: { tier: payload.data?.metadata?.tier },
        });
        break;
      }
      
      case "subscription.renewed": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_renewed",
          properties: { tier: payload.data?.metadata?.tier },
        });
        break;
      }
      
      case "subscription.failed": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_failed",
          properties: { tier: payload.data?.metadata?.tier },
        });
        break;
      }

      case "subscription.expired": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_expired",
        });
        break;
      }

      case "subscription.on_hold": {
        await addSubscriptiontoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "subscription_on_hold",
        });
        break;
      }
      
      case "payment.succeeded": {
        await addPaymenttoDb(payload);
        // A $0 succeeded payment with no prior paid payment marks the start of a
        // card-required free trial — schedule the "charged tomorrow" reminder.
        await maybeScheduleTrialReminder(payload);
        // A non-zero succeeded payment on a referred account's first conversion
        // rewards the referrer; everyone else is a no-op. Best-effort, never throws.
        await maybeRewardReferral(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "payment_succeeded",
          properties: { amount: payload.data?.amount, currency: payload.data?.currency },
        });
        break;
      }

      case "payment.processing": {
        await addPaymenttoDb(payload);
        break;
      }

      case "payment.cancelled": {
        await addPaymenttoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "payment_cancelled",
        });
        break;
      }

      case "payment.failed": {
        await addPaymenttoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "payment_failed",
        });
        break;
      }

      // A chargeback is the one case where the customer takes the money back without
      // our consent, so the seats it bought are stripped immediately. The remaining
      // dispute.* events are lifecycle notifications — recorded, but nothing to undo:
      // the seats are already gone by then, and winning does not restore them.
      case "dispute.opened": {
        await handleDisputeOpened(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "dispute_opened",
          properties: { amount: payload.data?.amount, currency: payload.data?.currency },
        });
        break;
      }

      case "dispute.accepted":
      case "dispute.cancelled":
      case "dispute.challenged":
      case "dispute.expired":
      case "dispute.lost":
      case "dispute.won": {
        console.log(
          "[dispute] %s for payment %s (dispute %s)",
          payload.type,
          payload.data?.payment_id,
          payload.data?.dispute_id,
        );
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: payload.type.replace(".", "_"),
          properties: { amount: payload.data?.amount, currency: payload.data?.currency },
        });
        break;
      }

      case "refund.failed":
        await addRefundtoDb(payload);
        break;
      
      case "refund.succeeded": {
        await addRefundtoDb(payload);
        posthog.capture({
          distinctId: clerkUserId || "system",
          event: "refund_succeeded",
        });
        break;
      }

      default:
        console.log("Unhandled webhook event:", payload.type);
    }

    await posthog.shutdown();

    return ctx.json({ success: true }, 200);
  } catch (error) {
    if (webhook_id) await unmarkDodoWebhookProcessed(webhook_id);
    return ctx.json({ error }, 500);
  }
});

export default app;
