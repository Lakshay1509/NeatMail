import { Hono } from "hono";

import { db } from "@/lib/prisma";
import { clerkClient } from "@clerk/nextjs/server";
import { activateWatch } from "@/lib/gmail";
import { getDodoPayments } from "./checkout";

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
      const activeSubscriptions = await db.subscription.findMany({
        where: {
          status: "active",
          user_tokens: {
            deleted_flag: false,
          },
        },
      });

      const results = {
        total: activeSubscriptions.length,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const sub of activeSubscriptions) {
        try {
          await activateWatch(sub.dodoSubscriptionId);
          results.successful++;
          console.log(`✅ Watch renewed for: ${sub.customerEmail}`);
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

  .post("/refund", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const payments = await db.paymentHistory.findMany({
        where: {
          status: "succeeded",
          settlementAmount: {
            gt: 0,
            not: null,
          },
          clerkUserId:"user_38NbAtb7Fk5Vmm0QIdSs5l0bMV5",
          createdAt: {
            lte: sevenDaysAgo,
          },
          refunds: {
            none: {},
          },
        },
        include: {
          subscription: true,
        },
      });

      if (payments.length === 0) {
        return ctx.json({ message: "No payments to refund" }, 200);
      }

      const dodopayments = getDodoPayments();

      const results = {
        total: payments.length,
        successful: 0,
        failed: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const payment of payments) {
        const paidAmount = (payment?.settlementAmount ?? 0) / 100;
        const subscriptionPrice =
          (payment.subscription?.recurringAmount ?? 0) / 100;
        const refundAmount = paidAmount - subscriptionPrice;

        if (!(paidAmount > 0 && refundAmount > 0 && payment.dodoPaymentId)) {
          results.skipped++;
          continue;
        }

        try {
          await dodopayments.refunds.create({
            payment_id: payment.dodoPaymentId,
            items: [
              {
                item_id: payment.subscription?.productId ?? "",
                amount: refundAmount,
              },
            ],
            metadata: {
              clerk_user_id: payment.subscription?.clerkUserId ?? "",
            },
            reason: "automated refund",
          });

          
          const wallets = await dodopayments.customers.wallets.list(
            payment.subscription?.dodoCustomerId ?? "",
          );

          if (wallets.total_balance_usd >= refundAmount) {
            await dodopayments.customers.wallets.ledgerEntries.create(
              payment.clerkUserId,
              {
                amount: refundAmount,
                currency: "USD",
                entry_type: "debit",
              },
            );
          }

          results.successful++;
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to refund payment ${payment.dodoPaymentId}: ${errorMessage}`,
          );
        }
      }

      return ctx.json({
        message: "Refund processing completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Refund cron job error:", error);
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
