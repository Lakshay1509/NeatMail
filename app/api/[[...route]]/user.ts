import { db } from "@/lib/prisma";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";
import { getDodoPayments } from "./checkout";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { getUserTier } from "@/lib/tier-guard";
import { getBillingOwnerId } from "@/lib/organization";
import { createOutlookSubscription, getFolderMap } from "@/lib/outlook";
import { updateOutlookId } from "@/lib/supabase";
import { handleWatchDeactivation } from "@/lib/payement";

export type WatchedFolder = {
  id: string;
  name: string;
};

const app = new Hono()

  .get("/default", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
    });

    if (!data) {
      return ctx.json({ error: "Error getting user data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/watch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: {
        watch_activated: true,
      },
    });

    if (!data) {
      return ctx.json({ error: "Error getting watch data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/subscription", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    // Billing (subscription, trial, tier) belongs to the org admin. Resolve to
    // the billing owner so a member sees the admin's plan. Self-billed users
    // resolve to themselves, so behaviour is unchanged for them.
    const billingOwnerId = await getBillingOwnerId(userId);

    const [data, freeTrial, user] = await Promise.all([
      db.subscription.findFirst({
        where: { clerkUserId: billingOwnerId },
        select: {
          cancelAtNextBillingDate: true,
          nextBillingDate: true,
          status: true,
          recurringAmount: true,
          paymentFrequencyInterval: true,
          paymentFrequencyCount: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      db.free_trial.findUnique({
        where: { user_id: billingOwnerId },
      }),
      db.user_tokens.findUnique({
        where: { clerk_user_id: billingOwnerId },
        select: { tier: true },
      }),
    ]);

    const zero_payment = await db.paymentHistory.findFirst({
      where:{clerkUserId:billingOwnerId,amount:0,status:'succeeded'},
      orderBy: { createdAt: "desc" },

    })

    // A real (post-trial) charge. Once this exists, the card trial has converted
    // to a paid subscription and should no longer report as a free trial.
    const paid_charge = await db.paymentHistory.findFirst({
      where: { clerkUserId: billingOwnerId, amount: { gt: 0 }, status: "succeeded" },
    });

    const tier = user?.tier ?? "FREE";

    const hasActiveTrial =
      freeTrial &&
      freeTrial.status === "ACTIVE" &&
      freeTrial.expires_at > new Date();

    // Card trial in progress: a $0 trial charge was recorded, the subscription is
    // active, and no real charge has happened yet. Flips to false automatically
    // after the first paid charge.
    const paidFreeTrial = !!zero_payment && data?.status === "active" && !paid_charge;

    if (!data && !hasActiveTrial) {
      return ctx.json({ success: false, subscribed: false, tier }, 200);
    }

    if (!data && hasActiveTrial) {
      return ctx.json(
        {
          success: true,
          subscribed: true,
          tier,
          status: "trial",
          next_billing_date: freeTrial.expires_at,
          cancel_at_next_billing_date: null,
          freeTrial: true,
        },
        200,
      );
    }

    if (data?.status !== "active" && hasActiveTrial) {
      return ctx.json(
        {
          success: true,
          subscribed: true,
          tier,
          status: "trial",
          next_billing_date: freeTrial.expires_at,
          cancel_at_next_billing_date: null,
          freeTrial: true,
        },
        200,
      );
    }

    const isAnnual =
      data!.paymentFrequencyInterval === "Year" ||
      data!.paymentFrequencyCount >= 12;

    const periodPrice = data!.recurringAmount / 100;

    return ctx.json(
      {
        success: true,
        subscribed: data!.status === "active",
        tier,
        status: data!.status,
        price: periodPrice,
        interval: isAnnual ? "annual" : "monthly",
        next_billing_date: data!.nextBillingDate,
        cancel_at_next_billing_date: data!.cancelAtNextBillingDate,
        freeTrial: paidFreeTrial,
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
        invoiceId: true,
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
      console.log("[scopes] STEP: no userId — returning 401");
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    console.log("[scopes] STEP: entry — userId:", userId);

    try {
      const user = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if (!user) {
        console.log("[scopes] STEP: user_tokens not found — throwing");
        throw Error("User not found");
      }

      console.log("[scopes] STEP: db user — is_gmail:", user.is_gmail);

      if (user.is_gmail) {
        const client = await clerkClient();

        console.log("[scopes] STEP: calling getUserOauthAccessToken(google)...");
        const tokenResponse = await client.users.getUserOauthAccessToken(
          userId,
          "google",
        );

        console.log("[scopes] STEP: tokenResponse data length:", tokenResponse?.data?.length);
        console.log("[scopes] STEP: tokenResponse raw:", JSON.stringify(tokenResponse?.data));

        const googleAccount = tokenResponse.data[0];
        console.log("[scopes] STEP: googleAccount:", googleAccount ? `exists (token length: ${googleAccount.token?.length})` : "undefined");
        console.log("[scopes] STEP: googleAccount?.token:", googleAccount?.token ? `present (${googleAccount.token.substring(0, 20)}...)` : "MISSING");

        if (!googleAccount?.token) {
          console.log("[scopes] CHECK: no token — returning false with 200");
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

        console.log("[scopes] STEP: building OAuth2 client...");
        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: googleAccount.token });

        console.log("[scopes] STEP: calling getTokenInfo...");
        try {
          const info = await oauth2.getTokenInfo(googleAccount.token);
          console.log("[scopes] tokeninfo OK — scopes:", info.scopes);
        } catch (err) {
          console.log("[scopes] tokeninfo FAILED:", (err as Error)?.message);
        }

        console.log("[scopes] STEP: Clerk stored scopes:", googleAccount.scopes);

        console.log("[scopes] STEP: probing Gmail API...");
        let hasGmailAccess = false;
        try {
          const probe = await oauth2.request({
            url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          });
          console.log("[scopes] Gmail API probe OK — status:", probe.status);
          hasGmailAccess = true;
        } catch (err) {
          console.log("[scopes] Gmail API probe FAILED:", (err as any)?.response?.data || (err as Error)?.message);
        }

        console.log("[scopes] CHECK: hasGmailAccess:", hasGmailAccess);

        if (hasGmailAccess) {
          console.log("[scopes] RESULT: returning true (has all scopes)");
          return ctx.json(
            {
              hasAllScopes: true,
              scopes: requiredScopes,
              missingScopes: [],
            },
            200,
          );
        }

        console.log("[scopes] RESULT: returning false (probe failed)");
        return ctx.json(
          {
            hasAllScopes: false,
            scopes: [],
            missingScopes: requiredScopes,
          },
          200,
        );
      } else {
        const client = await clerkClient();

        console.log("[scopes] STEP: calling getUserOauthAccessToken(microsoft)...");
        const tokenResponse = await client.users.getUserOauthAccessToken(
          userId,
          "microsoft",
        );

        console.log("[scopes] STEP: microsoft tokenResponse data length:", tokenResponse?.data?.length);

        const microsoftAccount = tokenResponse.data[0];
        console.log("[scopes] STEP: microsoftAccount:", microsoftAccount ? "exists" : "undefined");

        if (!microsoftAccount) {
          console.log("[scopes] CHECK: no microsoft account — returning false with 200");
          return ctx.json(
            {
              hasAllScopes: false,
              scopes: [],
              missingScopes: [
                "email",
                "Mail.ReadWrite",
                "MailboxSettings.ReadWrite",
                "offline_access",
                "openid",
                "profile",
                "User.Read",
              ],
            },
            200,
          );
        }

        const requiredScopes = [
          "email",
          "Mail.ReadWrite",
          "MailboxSettings.ReadWrite",
          "offline_access",
          "openid",
          "profile",
          "User.Read",
        ];

        const grantedScopes = microsoftAccount.scopes || [];
        console.log("[scopes] STEP: microsoft granted scopes:", grantedScopes);
        const missingScopes = requiredScopes.filter(
          (scope) => !grantedScopes.includes(scope),
        );
        console.log("[scopes] CHECK: microsoft missingScopes:", missingScopes);

        console.log("[scopes] RESULT: returning", missingScopes.length === 0 ? "true" : "false");
        return ctx.json(
          {
            hasAllScopes: missingScopes.length === 0,
            scopes: grantedScopes,
            missingScopes,
          },
          200,
        );
      }
    } catch (error) {
      console.log("[scopes] CATCH:", (error as Error)?.message);
      console.log("[scopes] CATCH full:", error);
      return ctx.json({ error: "Failed to fetch scopes" }, 500);
    }
  })

  .get("/walletBalance", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const dodoPayment = getDodoPayments();

    const dodocustomerID = await db.subscription.findFirst({
      where: { clerkUserId: userId },
      select: {
        dodoCustomerId: true,
      },
    });

    if (!dodocustomerID) {
      return ctx.json({ balance: 0 }, 200);
    }

    const wallets = await dodoPayment.customers.wallets.list(
      dodocustomerID?.dodoCustomerId,
    );

    return ctx.json({ balance: wallets.total_balance_usd }, 200);
  })

  .get("/isGmail", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: {
        is_gmail: true,
      },
    });

    if (!data) {
      return ctx.json({ error: "Error fetching is-gmail data for user" }, 500);
    }

    if (data.is_gmail === true) {
      return ctx.json({ is_gmail: true }, 200);
    }

    return ctx.json({ is_gmail: false }, 200);
  })

  .get("/activeFolders", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const foldersFromOutlook = await getFolderMap(userId);

    const dbResult = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { watched_folders: true },
    });

    const watchedFolders: WatchedFolder[] = Array.isArray(
      dbResult?.watched_folders,
    )
      ? (dbResult.watched_folders as WatchedFolder[])
      : [];

    const result = Array.from(foldersFromOutlook.entries())
      .filter(([_, node]) => node.name !== "Inbox")
      .map(([id, node]) => ({
        id,
        name: node.name,
        parentPath: node.parentPath,
        isActive: watchedFolders.some((f) => f.id === id),
      }));

    return ctx.json(result, 200);
  })

  .put(
    "/updateWatchedFolders",
    zValidator(
      "json",
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to manage watched folders" }, 403);
      }

      const userData = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true, email: true },
      });

      if (!userData) {
        return ctx.json({ error: "Error getting user data" }, 500);
      }

      const values = ctx.req.valid("json") as WatchedFolder[];

      await db.user_tokens.update({
        where: { clerk_user_id: userId },
        data: { watched_folders: values },
      });

      const response = await createOutlookSubscription(userId, values);
      await updateOutlookId(
        userData.email,
        response.map((r) => r.id).join(","),
        true,
      );

      return ctx.json({ success: true, watched_folders: values }, 200);
    },
  )

  .put(
    "update/moveToFolder",
    zValidator(
      "json",
      z.object({
        confirm: z.boolean(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const data = await db.user_tokens.update({
        where: { clerk_user_id: userId },
        data: {
          is_folder: values.confirm,
        },
      });

      if (!data) {
        return ctx.json({ error: "Error updating user prefernce" }, 500);
      }

      return ctx.json({ data }, 200);
    },
  )

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

      // 2. Deactivate watch (all users) + cancel subscription (if one exists).
      // Watch deactivation is independent of subscription status: free and
      // trial users also have an active watch that must be stopped so we stop
      // ingesting a deleted user's mailbox. handleWatchDeactivation swallows
      // its own errors, so it never blocks the deletion flow.
      await handleWatchDeactivation(userId);

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
        } catch (_err) {
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
  })

  //this route is for dev purpose only
  .get("/token", async (ctx) => {
    if (process.env.NODE_ENV !== "development") {
      return ctx.json({ error: "Not a dev env" }, 500);
    }

    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }
    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      userId,
      "google",
    );

    return ctx.json({ tokenResponse }, 200);
  });

export default app;
