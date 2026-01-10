import { auth, currentUser } from "@clerk/nextjs/server";
import DodoPayments from "dodopayments";

import { Hono } from "hono";

const dodopayments = new DodoPayments({
  environment: "test_mode",
  bearerToken: process.env.DODO_API!,
});

const app = new Hono().post("/", async (ctx) => {
  try {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const user = await currentUser();

    const name = user?.fullName ?? "";
    const emailAddress = user?.emailAddresses[0]?.emailAddress ?? "";

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
      metadata:{
        clerk_user_id:userId
      },
     return_url: `${process.env.NEXT_PUBLIC_API_URL!}/dashboard`
    });

    return ctx.json({ url: checkout.checkout_url }, 200);
  } catch (error) {
    return ctx.json({ error }, 500);
  }
});

export default app;
