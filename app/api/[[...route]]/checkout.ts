import { db } from "@/lib/prisma";
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

    const subscription = await db.subscription.findFirst({
          where:{
            clerkUserId:userId,
            status:'active'
          }
        })

    const payment = await db.paymentHistory.findFirst({
      where:{
        clerkUserId:userId,
        status:'processing'
      }
    })
    
    if(subscription || payment){
          return ctx.json({error:'You have active subscription or a payment in process'},409);
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
})

.post('cancelSubscription',async(ctx)=>{
  try{
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const renewQuery = ctx.req.query("renew");

    const subscription = await db.subscription.findFirst({
          where:{
            clerkUserId:userId,
            status:'active'
          }
    })

     if(!subscription){
          return ctx.json({error:'You do not have an active subscription'},409);
    }

    const renew =  renewQuery==='true' ? true :false

    const response = await fetch(
      `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.DODO_API!}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cancel_at_next_billing_date: renew
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to cancel subscription');
    }

    const data = await response.json();

    return ctx.json({ success: true, data }, 200);

  }catch(error){
    return ctx.json({error},500);
  }
})

export default app;
