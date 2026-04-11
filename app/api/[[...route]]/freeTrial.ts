import { handleWatchActivation } from "@/lib/payement";
import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()
  .post("/activate", async (ctx) => {
    const { userId } = await auth();

    const user = await currentUser();

    const email = user?.emailAddresses[0]?.emailAddress;

    if (!userId || !email) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const [freeTrial, subscription, payment] = await Promise.all([
      db.free_trial.findUnique({ where: { user_id: userId } }),
      db.subscription.findFirst({ where: { clerkUserId: userId } }),
      db.paymentHistory.findFirst({
        where: { clerkUserId: userId, amount: 0, status: "succeeded" },
      }),
    ]);

    if (freeTrial || subscription || payment) {
      return ctx.json(
        { error: "You already have a subscription or trial taken" },
        409,
      );
    }

    try {
      await db.free_trial.create({
        data: {
          user_id: userId,
          email: email,
          started_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: "ACTIVE",
        },
      });

      await handleWatchActivation(userId);
      return ctx.json({ message: "Free trial started" }, 200);
    } catch (_error) {
      return ctx.json({ error: "Error starting free trial" }, 500);
    }
  })

  .get("/status", async (ctx) => {
    const { userId } = await auth();

    const user = await currentUser();

    const email = user?.emailAddresses[0]?.emailAddress;

    if (!userId || !email) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const [freeTrial, subscription, payment] = await Promise.all([
      db.free_trial.findUnique({ where: { user_id: userId } }),
      db.subscription.findFirst({ where: { clerkUserId: userId } }),
      db.paymentHistory.findFirst({
        where: { clerkUserId: userId, amount: 0, status: "succeeded" },
      }),
    ]);

    if (!freeTrial && !subscription && !payment) {
      return ctx.json(
        {
          canTake: true,
        },
        200,
      );
    }

    return ctx.json(
      {
        canTake: false,
      },
      200,
    );
  });

export default app;
