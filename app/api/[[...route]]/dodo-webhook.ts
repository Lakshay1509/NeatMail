//https://gmail-classifier-nine.vercel.app/api/dodowebhook

import { Hono } from "hono";
import { Webhook } from "standardwebhooks";
import { addSubscriptiontoDb } from "@/lib/payement";

const app = new Hono().post("/", async (ctx) => {
  try {
    const WEBHOOK_SECRET = process.env.DODO_WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      return ctx.json({ error: "Please add dodo webhook to .env" }, 400);
    }

    const webhook_id = ctx.req.header("webhook-id");
    const webhook_timestamp = ctx.req.header("webhook-timestamp");
    const webhook_signature = ctx.req.header("webhook-signature");

    if (!webhook_id || !webhook_timestamp || !webhook_signature) {
      return new Response("Missing webhook headers", { status: 400 });
    }

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
      return ctx.json({ error: err }, 400);
    }

    switch (payload.type) {
      case "payment.succeeded":
        console.log("Payment succeeded", payload.data);

        break;

      case "payment.failed":
        console.log("Payment failed:", payload.data);
        // Handle failed payment
        break;

      case "subscription.created":
        await addSubscriptiontoDb(payload.data);
        console.log("Subscription created:", payload.data);
        // Handle new subscription
        break;

      case "subscription.cancelled":
        console.log("Subscription cancelled:", payload.data);
        // Handle subscription cancellation
        break;

      case "subscription.updated":
        console.log("Subscription updated:", payload.data);
        // Handle subscription update
        break;

      default:
        console.log("Unhandled webhook event:", payload.type);
    }

    return ctx.json({ success: "true" }, 200);
  } catch (error) {
    return ctx.json({ error }, 500);
  }
});

export default app;
