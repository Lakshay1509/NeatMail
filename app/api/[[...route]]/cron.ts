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

      console.log(`[refund] Querying payments older than: ${sevenDaysAgo.toISOString()}`);

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

      console.log(`[refund] Found ${payments.length} payment(s) eligible for refund`);

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
        const paidAmount = payment?.settlementAmount ?? 0;
        const subscriptionPrice = payment.subscription?.recurringAmount ?? 0;
        const refundAmount = paidAmount - subscriptionPrice;

        const paidAmountDisplay = paidAmount / 100;
        const subscriptionPriceDisplay = subscriptionPrice / 100;
        const refundAmountDisplay = refundAmount / 100;

        console.log(
          `[refund] Processing payment ${payment.dodoPaymentId} | clerkUserId=${payment.clerkUserId} | paidAmount=${paidAmountDisplay} | subscriptionPrice=${subscriptionPriceDisplay} | refundAmount=${refundAmountDisplay} | refundAmountRaw(cents)=${refundAmount}`,
        );

        if (!(paidAmount > 0 && refundAmount > 0 && payment.dodoPaymentId)) {
          console.log(
            `[refund] ⏭️ Skipping payment ${payment.dodoPaymentId} — condition not met (paidAmount=${paidAmount}, refundAmount=${refundAmount}, dodoPaymentId=${payment.dodoPaymentId})`,
          );
          results.skipped++;
          continue;
        }

        try {
          console.log(`[refund] Creating refund for payment ${payment.dodoPaymentId} | amount(cents)=${refundAmount} | productId=${payment.subscription?.productId}`);

          await dodopayments.refunds.create({
            payment_id: payment.dodoPaymentId,
            items: [
              {
                item_id: payment.subscription?.productId ?? "",
                amount: refundAmount, // integer cents, no division
              },
            ],
            metadata: {
              clerk_user_id: payment.subscription?.clerkUserId ?? "",
            },
            reason: "automated refund",
          });

          console.log(`[refund] ✅ Refund created for payment ${payment.dodoPaymentId}`);

          console.log(`[refund] Listing wallets for dodoCustomerId=${payment.subscription?.dodoCustomerId}`);

          const wallets = await dodopayments.customers.wallets.list(
            payment.subscription?.dodoCustomerId ?? "",
          );

          console.log(`[refund] Wallet total_balance_usd=${wallets.total_balance_usd} | required refundAmount=${refundAmountDisplay}`);

          if (wallets.total_balance_usd >= refundAmountDisplay) {
            console.log(`[refund] Debiting wallet for clerkUserId=${payment.clerkUserId} | amount(cents)=${refundAmount}`);

            await dodopayments.customers.wallets.ledgerEntries.create(
              payment.clerkUserId,
              {
                amount: refundAmount, // integer cents (int64), not divided
                currency: "USD",
                entry_type: "debit",
              },
            );

            console.log(`[refund] ✅ Wallet debited for clerkUserId=${payment.clerkUserId}`);
          } else {
            console.warn(
              `[refund] ⚠️ Insufficient wallet balance for clerkUserId=${payment.clerkUserId} | balance=${wallets.total_balance_usd} < refundAmount=${refundAmountDisplay} — skipping debit`,
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
          console.error(`[refund] ❌ Error processing payment ${payment.dodoPaymentId}:`, error);
        }
      }

      console.log(`[refund] Done | total=${results.total} successful=${results.successful} failed=${results.failed} skipped=${results.skipped}`);

      return ctx.json({
        message: "Refund processing completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("[refund] ❌ Unexpected cron job error:", error);
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
