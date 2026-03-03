

import { Hono } from "hono";
import { Webhook } from "standardwebhooks";
import { addPaymenttoDb, addRefundtoDb, addSubscriptiontoDb } from "@/lib/payement";
import { isDodoWebhookProcessed, markDodoWebhookProcessed, unmarkDodoWebhookProcessed } from "@/lib/redis";

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

    switch (payload.type) {
      case "subscription.created": 
        await addSubscriptiontoDb(payload);
        break;

      case "subscription.cancelled":
        await addSubscriptiontoDb(payload);
        break;

      case "subscription.updated":
        await addSubscriptiontoDb(payload);
        break;
      
      case "subscription.active":
        await addSubscriptiontoDb(payload);
        break;
      
      case "subscription.renewed":
        await addSubscriptiontoDb(payload);
        break;
      
      case "subscription.failed":
        await addSubscriptiontoDb(payload);
        break;

      case "subscription.expired":
        await addSubscriptiontoDb(payload);
        break;

      case "subscription.on_hold":
        await addSubscriptiontoDb(payload);
        break;
      
      case "payment.succeeded":
        await addPaymenttoDb(payload);
        break;

      case "payment.processing":
        await addPaymenttoDb(payload);
        break;


      case "payment.cancelled":
        await addPaymenttoDb(payload);
        break;

      case "payment.failed":
        await addPaymenttoDb(payload);
        break;

      case "refund.failed":
        await addRefundtoDb(payload);
        break;
      
      case "refund.succeeded":
        await addRefundtoDb(payload);
        break;

      default:
        console.log("Unhandled webhook event:", payload.type);
    }

    return ctx.json({ success: true }, 200);
  } catch (error) {
    if (webhook_id) await unmarkDodoWebhookProcessed(webhook_id);
    return ctx.json({ error }, 500);
  }
});

export default app;
