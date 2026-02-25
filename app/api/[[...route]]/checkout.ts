import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import DodoPayments from "dodopayments";

import { Hono } from "hono";

export const getDodoPayments = () => {
  return new DodoPayments({
    environment:
      process.env.NODE_ENV === "production" ? "live_mode" : "test_mode",
    bearerToken: process.env.DODO_API!,
  });
};

const app = new Hono()
  .post("/", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      // Check for existing subscription with various statuses
      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      // Check for processing payment
      const payment = await db.paymentHistory.findFirst({
        where: {
          clerkUserId: userId,
          status: "processing",
        },
      });

      // Block if active, pending, or payment processing
      if (
        subscription?.status === "active" ||
        subscription?.status === "pending" ||
        payment
      ) {
        return ctx.json(
          { error: "You have an active subscription or a payment in process" },
          409,
        );
      }

      const user = await currentUser();
      const name = user?.fullName ?? "";
      const emailAddress = user?.emailAddresses[0]?.emailAddress ?? "";
      const dodopayments = getDodoPayments();

      // Handle on_hold status - update payment method
      if (subscription?.status === "on_hold") {
        const response = await dodopayments.subscriptions.updatePaymentMethod(
          subscription.dodoSubscriptionId,
          {
            type: "new",
            return_url: `${process.env.NEXT_PUBLIC_API_URL!}`,
          },
        );

        if (response.payment_id) {
          console.log("Charge created:", response.payment_id);
          return ctx.json({ url: response.payment_link }, 200);
        }
      }

      // Check if trial was already taken (any successful payment with 0 amount OR any subscription created)
      const trialTaken = await db.paymentHistory.findFirst({
        where: {
          clerkUserId: userId,
          amount: 0,
          status: "succeeded",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Detect country from Vercel's geo header and pick the right product
      const country = ctx.req.header("x-vercel-ip-country") ?? "";
      const productId =
        country === "IN"
          ? process.env.DODO_PRODUCT_ID_INDIA
          : process.env.DODO_PRODUCT_ID_GLOBAL;

      if (!productId) {
        console.error(
          `Missing product ID env var for country "${country}": expected ${country === "IN" ? "DODO_PRODUCT_ID_INDIA" : "DODO_PRODUCT_ID_GLOBAL"}`,
        );
        return ctx.json({ error: "Payment configuration error" }, 500);
      }

      // Create new checkout session
      const checkout = await dodopayments.checkoutSessions.create({
        product_cart: [
          {
            product_id: productId,
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: trialTaken ? 0 : 14,
        },
        customer: {
          email: emailAddress,
          name: name,
        },
        metadata: {
          clerk_user_id: userId,
        },
        return_url: `${process.env.NEXT_PUBLIC_API_URL!}`,
      });

      return ctx.json({ url: checkout.checkout_url }, 200);
    } catch (error) {
      console.error("Checkout error:", error);
      return ctx.json({ error: "Failed to create checkout session" }, 500);
    }
  })

  .post("cancelSubscription", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const renewQuery = ctx.req.query("renew");

      // Allow cancellation for both active and on_hold subscriptions
      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: { in: ["active", "on_hold"] },
        },
      });

      if (!subscription) {
        return ctx.json(
          {
            error:
              "You do not have an active or on-hold subscription to cancel",
          },
          409,
        );
      }

      const renew = renewQuery === "true" ? true : false;

      const response = await fetch(
        `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.DODO_API!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cancel_at_next_billing_date: renew,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to cancel subscription");
      }

      const data = await response.json();

      return ctx.json({ success: true, data }, 200);
    } catch (error) {
      console.error("Cancel subscription error:", error);
      return ctx.json({ error: "Failed to cancel subscription" }, 500);
    }
  })

  .get("/invoice/:id", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const payment_id = ctx.req.param("id");

      if (!payment_id) {
        return ctx.json({ error: "No payment id in the params" }, 400);
      }

      const invoice_data = await db.paymentHistory.findUnique({
        where: { dodoPaymentId: payment_id },
      });

      if (!invoice_data) {
        return ctx.json({ error: "No invoice data" }, 500);
      }

      if (invoice_data.clerkUserId !== userId) {
        return ctx.json(
          { error: "Unauthorized user for the given invoice" },
          401,
        );
      }

      console.log("Fetching invoice for payment_id:", payment_id);

      const dodopayments = getDodoPayments();
      const payment = await dodopayments.invoices.payments.retrieve(payment_id);

      console.log("Payment response type:", typeof payment);
      console.log("Payment response:", payment);

      if (!payment) {
        return ctx.json({ error: "Error getting invoice" }, 500);
      }

      const buffer = Buffer.from(await payment.arrayBuffer());
      console.log("Buffer length:", buffer.length);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="invoice-${payment_id}.pdf"`,
          "Content-Length": buffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Invoice download error:", error);
      return ctx.json({ error: "Failed to download invoice" }, 500);
    }
  });

export default app;
