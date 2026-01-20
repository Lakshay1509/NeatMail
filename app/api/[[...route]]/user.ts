import { deactivateWatch } from "@/lib/gmail";
import { db } from "@/lib/prisma";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()
  .get("/watch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
    });

    if (!data) {
      return ctx.json({ error: "Error getting watch data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/mailsThisMonth", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const data = await db.email_tracked.count({
      where: {
        user_id: userId,
        created_at: {
          gte: startOfMonth,
          lt: startOfNextMonth,
        },
      },
    });

    return ctx.json({ data }, 200);
  })

  .get("/drafts", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.drafts.findMany({
      where: { user_id: userId },
      orderBy: {
        created_at: "desc",
      },
    });

    if (!data) {
      return ctx.json({ error: "Error getting draft data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/subscription", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.subscription.findFirst({
      where: { clerkUserId: userId, status: "active" },
      select: {
        cancelAtNextBillingDate: true,
        nextBillingDate: true,
      },
    });

    if (!data) {
      return ctx.json(
        {
          success: false,
          subscribed: false,
        },
        200,
      );
    }

    return ctx.json(
      {
        success: true,
        subscribed: true,
        next_billing_date: data.nextBillingDate,
        cancel_at_next_billing_date: data.cancelAtNextBillingDate,
      },
      200,
    );
  })

  .get("/payments", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.paymentHistory.findMany({
      where: { clerkUserId: userId },
      select: {
        id: true,
        status: true,
        dodoPaymentId: true,
        paymentMethod: true,
        amount: true,
        currency: true,
        createdAt: true,
      },
    });

    return ctx.json({ data }, 200);
  })

  .get("/deleteStatus", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: {
        delete_at: true,
        deleted_flag: true,
      },
    });

    if (!data) {
      return ctx.json({ error: "Error getting data" }, 500);
    }

    return ctx.json({ data }, 200);
  })
  .get("/scopes", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const client = await clerkClient();

      const tokenResponse = await client.users.getUserOauthAccessToken(
        userId,
        "google",
      );

      const googleAccount = tokenResponse.data[0];

      if (!googleAccount) {
        return ctx.json(
          {
            hasAllScopes: false,
            scopes: [],
            missingScopes: [
              "https://www.googleapis.com/auth/gmail.compose",
              "https://www.googleapis.com/auth/gmail.labels",
              "https://www.googleapis.com/auth/gmail.modify",
              "https://www.googleapis.com/auth/gmail.readonly",
            ],
          },
          200,
        );
      }

      const requiredScopes = [
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.readonly",
      ];

      // scopes is already an array, no need to split
      const grantedScopes = googleAccount.scopes || [];
      const missingScopes = requiredScopes.filter(
        (scope) => !grantedScopes.includes(scope),
      );

      return ctx.json(
        {
          hasAllScopes: missingScopes.length === 0,
          scopes: grantedScopes,
          missingScopes,
        },
        200,
      );
    } catch (error) {
      console.error("Error fetching scopes:", error);
      return ctx.json({ error: "Failed to fetch scopes" }, 500);
    }
  })

  .put("/delete/:status", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const status = ctx.req.param("status");

    if (!["request", "cancel"].includes(status)) {
      return ctx.json({ error: "Invalid status" }, 400);
    }

    const isDeleteRequested = status === "request";

    if (isDeleteRequested) {
      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: "active",
        },
      });

      // 2. Deactivate watch + cancel subscription (ONLY if subscription exists)
      if (subscription) {
        // Cancel Dodo subscription
        try {
          const response = await fetch(
            `${process.env.DODO_WEB_URL!}/subscriptions/${subscription.dodoSubscriptionId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${process.env.DODO_API!}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                cancel_at_next_billing_date: true,
              }),
            },
          );

          if (!response.ok) {
            throw new Error("Failed to cancel Dodo subscription");
          }
        } catch (err) {
          return ctx.json({ error: "Error deleting dodo subscription" }, 500);
          // Continue - user deletion should not be blocked
        }
      }

      const data = await db.user_tokens.update({
        where: {
          clerk_user_id: userId,
        },
        data: {
          deleted_flag: true,
          delete_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
        },
      });

      if (!data) {
        return ctx.json({ error: "Error deleting user" }, 500);
      }

      return ctx.json({ data }, 200);
    } else {
      const data = await db.user_tokens.update({
        where: {
          clerk_user_id: userId,
        },
        data: {
          deleted_flag: false,
          delete_at: null,
        },
      });

      if (!data) {
        return ctx.json({ error: "Error deleting user" }, 500);
      }

      return ctx.json({ data }, 200);
    }
  });

export default app;
