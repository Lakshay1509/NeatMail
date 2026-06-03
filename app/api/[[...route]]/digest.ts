import { Hono } from "hono";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import {
  getDigestForUser,
  getDigestCount,
  trimDigestForEmail,
  markEmailAsDone,
  snoozeEmail,
} from "@/lib/digest";
import { db } from "@/lib/prisma";
import { Resend } from "resend";
import DailyDigestEmail from "@/components/Email/DailyDigestEmail";
import { render } from "@react-email/render";
import { formatInTimeZone } from "date-fns-tz";

const app = new Hono()
  .get("/", async (c) => {
    const { userId } = await auth();
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const digest = await getDigestForUser(userId);
    return c.json({ digest });
  })
  .get("/count", async (c) => {
    const { userId } = await auth();
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const count = await getDigestCount(userId);
    return c.json({ count });
  })
  .post(
    "/done",
    zValidator(
      "json",
      z.object({
        messageId: z.string().min(1),
      }),
    ),
    async (c) => {
      const { userId } = await auth();
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const { messageId } = c.req.valid("json");
      await markEmailAsDone(userId, messageId);
      return c.json({ success: true });
    },
  )
  .post(
    "/snooze",
    zValidator(
      "json",
      z.object({
        messageId: z.string().min(1),
        until: z.string().datetime(),
      }),
    ),
    async (c) => {
      const { userId } = await auth();
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const { messageId, until } = c.req.valid("json");
      await snoozeEmail(userId, messageId, new Date(until));
      return c.json({ success: true, snoozed_until: until });
    },
  )
  .get("/preferences", async (c) => {
    const { userId } = await auth();
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const pref = await db.digest_preference.findUnique({
      where: { user_id: userId },
    });

    return c.json({ preference: pref ?? null });
  })
  .post(
    "/preferences",
    zValidator(
      "json",
      z.object({
        enabled: z.boolean().optional(),
        deliveryTime: z
          .string()
          .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:mm)")
          .optional(),
        timezone: z.string().optional(),
      }),
    ),
    async (c) => {
      const { userId } = await auth();
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const body = c.req.valid("json");

      const existing = await db.digest_preference.findUnique({
        where: { user_id: userId },
      });

      let pref;
      if (existing) {
        pref = await db.digest_preference.update({
          where: { user_id: userId },
          data: {
            ...(body.enabled !== undefined && { enabled: body.enabled }),
            ...(body.deliveryTime !== undefined && {
              delivery_time: body.deliveryTime,
            }),
            ...(body.timezone !== undefined && { timezone: body.timezone }),
          },
        });
      } else {
        pref = await db.digest_preference.create({
          data: {
            user_id: userId,
            enabled: body.enabled ?? true,
            delivery_time: body.deliveryTime ?? "09:00",
            timezone: body.timezone ?? "UTC",
          },
        });
      }

      return c.json({ preference: pref });
    },
  )
  .post("/test", async (c) => {
    const { userId } = await auth();
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const user = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { email: true },
      });

      if (!user?.email) {
        return c.json({ error: "User email not found" }, 400);
      }

      const count = await getDigestCount(userId);

      if (count === 0) {
        await resend.emails.send({
          from: "NeatMail <digest@send.neatmail.app>",
          to: user.email,
          subject: "You're all caught up 🎉",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
            <h2 style="font-size:20px;color:#111;margin:0 0 16px;">Good morning — your inbox is clear.</h2>
            <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
              No flagged emails from the last 24 hours. NeatMail kept everything organized while you were away.
            </p>
            <a href="https://dashboard.neatmail.app" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Open Dashboard</a>
            <p style="font-size:12px;color:#888;margin-top:24px;">Your daily digest from NeatMail</p>
          </div>`,
        });
      } else {
        const digest = await getDigestForUser(userId);
        const trimmed = trimDigestForEmail(digest, 5);
        const shownCount = trimmed.groups.reduce((sum, g) => sum + g.emails.length, 0);
        const dateLabel = formatInTimeZone(new Date(), "UTC", "EEEE, MMMM d");

        const emailHtml = await render(
          DailyDigestEmail({
            totalEmails: shownCount,
            dateLabel,
            remainingCount: trimmed.remainingCount,
            groups: trimmed.groups.map((g) => ({
              urgency: g.urgency,
              label: g.label,
              emails: g.emails.map((e) => ({
                ai_summary: e.ai_summary,
                ai_action: e.ai_action,
                from: e.from,
                ageText: getAgeText(e.created_at),
              })),
            })),
          })
        );

        await resend.emails.send({
          from: "NeatMail <digest@send.neatmail.app>",
          to: user.email,
          subject: `[TEST] NeatMail digest: ${shownCount} email${shownCount > 1 ? "s" : ""}`,
          html: emailHtml,
        });
      }

      return c.json({
        success: true,
        message: "Test digest sent to your email",
      });
    } catch (error) {
      console.error("Test digest error:", error);
      return c.json({
        error: "Failed to send test digest",
        details: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  });

function getAgeText(createdAt: Date | string): string {
  const hours = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60),
  );
  if (hours < 1) return "Just now";
  if (hours === 1) return "1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default app;
