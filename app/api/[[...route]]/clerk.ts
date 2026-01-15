//https://gmail-classifier-nine.vercel.app/api/clerk/webhook

import { deactivateWatch } from "@/lib/gmail";
import { db } from "@/lib/prisma";
import { WebhookEvent } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { Webhook } from "svix";

const app = new Hono().post("/webhook", async (ctx) => {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    return ctx.json({ error: "Please add clerk webhook to .env" }, 400);
  }

  const svix_id = ctx.req.header("svix-id");
  const svix_timestamp = ctx.req.header("svix-timestamp");
  const svix_signature = ctx.req.header("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await ctx.req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return ctx.json({ error: "Webhook verification failed" }, 400);
  }

  const eventType = evt.type;

  if (eventType === "user.created") {
    const { id, email_addresses } = evt.data;

    const data = await db.user_tokens.upsert({
      where: { clerk_user_id: id },
      update: {
        gmail_email: email_addresses[0]?.email_address,
      },
      create: {
        clerk_user_id: id,
        gmail_email: email_addresses[0]?.email_address,
      },
    });

    if (!data) {
      return ctx.json({ error: "Error creating user" }, 500);
    }

    return ctx.json({ success: true, message: "User created" }, 200);
  }

  if (eventType === "user.updated") {
    const { id, email_addresses } = evt.data;
    const data = await db.user_tokens.upsert({
      where: { clerk_user_id: id },
      update: { gmail_email: email_addresses[0]?.email_address },
      create: {
        clerk_user_id: id,
        gmail_email: email_addresses[0]?.email_address,
      },
    });

    if (!data) {
      return ctx.json({ error: "Error updating user" }, 500);
    }

    return ctx.json({ success: true, message: "User updated" }, 200);
  }

  if (eventType === "user.deleted") {
  const { id: clerkUserId } = evt.data;

  // 1. Find active subscription (optional)
  const subscription = await db.subscription.findFirst({
    where: {
      clerkUserId,
      status: "active",
    },
  });

  // 2. Deactivate watch + cancel subscription (ONLY if subscription exists)
  if (subscription) {
    try {
      // Deactivate Gmail / Google watch
      await deactivateWatch(subscription.id);

      // Cancel Dodo subscription
      const response = await fetch(
        `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.DODO_API!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cancel_at_next_billing_date: true,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to cancel Dodo subscription");
      }
    } catch (err) {
      console.error("Subscription cleanup failed:", err);
      // continue — user deletion should not be blocked
    }
  }

  // 3. DB Transaction (always runs)
  await db.$transaction(async (tx) => {
    // Delete user 
    await tx.user_tokens.delete({
      where: {
        clerk_user_id: clerkUserId,
      },
    });
  });

  return ctx.json(
    {
      success: true,
      message: subscription
        ? "User deleted and subscription cancelled"
        : "User deleted (no active subscription)",
    },
    200
  );
}


  return ctx.json({ success: true, message: "Webhook received" }, 200);
})

export default app;
