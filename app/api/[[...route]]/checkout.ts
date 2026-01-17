import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import DodoPayments from "dodopayments";

import { Hono } from "hono";


const getDodoPayments = () => {
  return new DodoPayments({
    environment: process.env.NODE_ENV === 'production'
      ? 'live_mode'
      : 'test_mode',
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

      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: "active",
        },
      });

      const payment = await db.paymentHistory.findFirst({
        where: {
          clerkUserId: userId,
          status: "processing",
        },
      });

      if (subscription || payment) {
        return ctx.json(
          { error: "You have active subscription or a payment in process" },
          409
        );
      }

      const user = await currentUser();

      const name = user?.fullName ?? "";
      const emailAddress = user?.emailAddresses[0]?.emailAddress ?? "";

      const dodopayments = getDodoPayments();
      
      const checkout = await dodopayments.checkoutSessions.create({
        product_cart: [
          {
            product_id: process.env.DODO_PRODUCT_ID!,
            quantity: 1,
          },
        ],
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
      return ctx.json({ error }, 500);
    }
  })

  .post("cancelSubscription", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const renewQuery = ctx.req.query("renew");

      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: "active",
        },
      });

      if (!subscription) {
        return ctx.json(
          { error: "You do not have an active subscription" },
          409
        );
      }

      const renew = renewQuery === "true" ? true : false;

      const response = await fetch(
        `${process.env.DODO_WEB_URL!}/subscriptions/${
          subscription.dodoSubscriptionId
        }`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.DODO_API!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cancel_at_next_billing_date: renew,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to cancel subscription");
      }

      const data = await response.json();

      return ctx.json({ success: true, data }, 200);
    } catch (error) {
      console.log(error);
      return ctx.json({ error }, 500);
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
          401
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
