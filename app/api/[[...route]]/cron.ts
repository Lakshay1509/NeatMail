import { Hono } from "hono";

import { db } from "@/lib/prisma";
import { clerkClient } from "@clerk/nextjs/server";
import { activateWatch } from "@/lib/gmail";
import { updateHistoryId, updateOutlookId } from "@/lib/supabase";
import { createOutlookSubscription } from "@/lib/outlook";
import { Autosend } from "autosendjs";

const app = new Hono()
  .get("/delete-user", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const clerk = clerkClient();

      const usersToDelete = await db.user_tokens.findMany({
        where: {
          deleted_flag: true,
          delete_at: {
            lte: new Date(),
          },
        },
      });

      const results = {
        total: usersToDelete.length,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const user of usersToDelete) {
        try {
          await (await clerk).users.deleteUser(user.clerk_user_id);

          await db.user_tokens.delete({
            where: {
              clerk_user_id: user.clerk_user_id,
            },
          });

          results.successful++;
          console.log(`Successfully deleted user: ${user.clerk_user_id}`);
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to delete user ${user.clerk_user_id}: ${errorMessage}`,
          );
          console.error(`Failed to delete user ${user.clerk_user_id}:`, error);
        }
      }

      return ctx.json({
        message: "User deletion completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/renew-watch", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const [activeSubscriptions, activeTrials] = await Promise.all([
        db.subscription.findMany({
          where: {
            status: "active",
            user_tokens: { deleted_flag: false },
          },
          select: {
            dodoSubscriptionId: true,
            customerEmail: true,
            user_tokens: {
              select: {
                clerk_user_id: true,
                is_gmail: true,
              },
            },
          },
        }),
        db.free_trial.findMany({
          where: {
            status: "ACTIVE",
            expires_at: { gt: new Date() },
            user_tokens: { deleted_flag: false },
          },
          select: {
            user_id: true,
            email: true,
            user_tokens: {
              select: {
                clerk_user_id: true,
                is_gmail: true,
              },
            },
          },
        }),
      ]);

      const results = {
        total: activeSubscriptions.length + activeTrials.length,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };
      

      for (const sub of activeSubscriptions) {
        try {
          if (sub.user_tokens.is_gmail === true) {
            const response = await activateWatch(sub.user_tokens.clerk_user_id);

            await updateHistoryId(sub.customerEmail, response.history_id, true);

            results.successful++;
            console.log(`✅ Watch renewed for: ${sub.customerEmail}`);
          } else {
            const response = await createOutlookSubscription(
              sub.user_tokens.clerk_user_id,
            );
            await updateOutlookId(sub.customerEmail, response.id, true);

            results.successful++;
            console.log(`✅ Watch renewed outlook for: ${sub.customerEmail}`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to renew watch for ${sub.customerEmail}: ${errorMessage}`,
          );
          console.error(
            `❌ Watch renewal failed for ${sub.customerEmail}:`,
            error,
          );
        }
      }

       for (const sub of activeTrials) {
        try {
          if (sub.user_tokens.is_gmail === true) {
            const response = await activateWatch(sub.user_tokens.clerk_user_id);

            await updateHistoryId(sub.email, response.history_id, true);

            results.successful++;
            console.log(`✅ Watch renewed for: ${sub.email}`);
          } else {
            const response = await createOutlookSubscription(
              sub.user_tokens.clerk_user_id,
            );
            await updateOutlookId(sub.email, response.id, true);

            results.successful++;
            console.log(`✅ Watch renewed outlook for: ${sub.email}`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to renew watch for ${sub.email}: ${errorMessage}`,
          );
          console.error(
            `❌ Watch renewal failed for ${sub.email}:`,
            error,
          );
        }
      }

      return ctx.json({
        message: "Watch renewal completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Watch renewal cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/mail/send-reminder", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const now = new Date();
      const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const autosend = new Autosend(process.env.AUTOSEND_API_KEY!, {
        baseUrl: "https://api.autosend.com/v1",
        timeout: 30000,
        maxRetries: 3,
        debug: false,
      });

      const subscriptions = await db.subscription.findMany({
        where: {
          status: "active",
          nextBillingDate: {
            gte: now,
            lt: in24Hours,
          },
          cancelAtNextBillingDate: true,
        },
      });

      for (const sub of subscriptions) {
        try {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

          const startOfNextMonth = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            1,
          );

          const data = await db.email_tracked.count({
            where: {
              user_id: sub.clerkUserId,
              created_at: {
                gte: startOfMonth,
                lt: startOfNextMonth,
              },
            },
          });

          const client = await clerkClient();
          const clerkUser = await client.users.getUser(sub.clerkUserId);

          await autosend.emails.send({
            from: { email: "subscription@mail.neatmail.app", name: "NeatMail" },
            to: { email: sub.customerEmail },
            subject: "Quick reminder: Your NeatMail plan ends soon",
            templateId: "A-06b8aaad61bd8c3afc94",
            dynamicData: {
              firstName: clerkUser.fullName ?? "",
              last30DaysCount: data,
              renewalLink: "https://dashboard.neatmail.app/billing",
            },
          });
        } catch (error) {
          console.error(
            `Failed to send reminder to ${sub.customerEmail}:`,
            error,
          );
        }
      }

      return ctx.json({
        message: "Reminder check completed",
        timestamp: now.toISOString(),
        total: subscriptions.length,
        subscriptions,
      });
    } catch (error) {
      console.error("Send reminder cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/deactivate-trials", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const result = await db.free_trial.updateMany({
        where: {
          status: "ACTIVE",
          expires_at: { lte: new Date() },
        },
        data: {
          status: "EXPIRED",
        },
      });

      console.log(result.count)

      return ctx.json({
        message: "Free trial deactivation completed",
        timestamp: new Date().toISOString(),
        deactivatedCount: result.count,
      });
    } catch (error) {
      console.error("Deactivate free trials cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  });

export default app;
