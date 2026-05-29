import { outlookMailQueue, outlookMailUpdateQueue } from "@/lib/queue";
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

    const jobs = notifications
      .filter(
        (n) => n.clientState === process.env.OUTLOOK_WEBHOOK_SECRET,
      )
      .filter((n) => n.resourceData?.id && n.subscriptionId)
      .map((n) => {
        const jobId = `outlook/msg/${n.resourceData.id as string}-${n.changeType}`;
        const data = {
          messageId: n.resourceData.id as string,
          subscriptionId: n.subscriptionId as string,
        };
        const queue =
          n.changeType === "updated"
            ? outlookMailUpdateQueue
            : outlookMailQueue;
        return queue.add("process-mail", data, { jobId });
      });

    if (jobs.length > 0) {
      await Promise.all(jobs);
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
