//https://gmail-classifier-nine.vercel.app/api/clerk/webhook

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
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;
    const data = await db.user_tokens.delete({
      where: { clerk_user_id: id },
    });

    if (!data) {
      return ctx.json({ error: "Error deleting user" }, 500);
    }
  }
})

export default app;
