import { inngest } from "@/lib/inngest";
import { Hono } from "hono";

const app = new Hono().post("/webhook", async (ctx) => {
  const { searchParams } = new URL(ctx.req.url);
  const validationToken = searchParams.get("validationToken");

  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const body = await ctx.req.json();
    const notifications: any[] = body.value ?? [];   

    const events = notifications
      .filter(
        (n) => n.clientState === process.env.OUTLOOK_WEBHOOK_SECRET,
      )
      .filter((n) => n.resourceData?.id && n.subscriptionId)
      .map((n) => ({
        // Setting `id` makes Inngest deduplicate events with the same key,
        // preventing double processing when Graph resends or a folder-move
        // triggers a second notification for the same message.
        id: `outlook/msg/${n.resourceData.id as string}`,
        name: "outlook/mail.received" as const,
        data: {
          messageId: n.resourceData.id as string,
          subscriptionId: n.subscriptionId as string,
        },
      }));

    if (events.length > 0) {
      await inngest.send(events);
    }

    // Must return 202 quickly — Graph drops the notification after 3s
    return new Response(null, { status: 202 });
  } catch (err) {
    console.error("Outlook webhook error:", err);
    // Still return 202 so Graph doesn't keep retrying a bad payload
    return new Response(null, { status: 202 });
  }
});

export default app;
