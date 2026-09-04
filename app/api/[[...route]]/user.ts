import { db } from "@/lib/prisma";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";
import { getDodoPayments } from "./checkout";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { getUserTier } from "@/lib/tier-guard";
import { resolveSubscriptionStatus } from "@/lib/subscription";
import { isMemberAccessPaused } from "@/lib/organization";
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

    const [data, paused] = await Promise.all([
      db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: {
          watch_activated: true,
        },
      }),
      // Reflects the admin's pause instead of a misleading "off, click to enable" state,
      // and blocks a reactivation activate-watch would reject anyway.
      isMemberAccessPaused(userId),
    ]);

    if (!data) {
      return ctx.json({ error: "Error getting watch data" }, 500);
    }

    return ctx.json({ data, paused }, 200);
  })

  .get("/subscription", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    // Resolves through the org admin (billing owner), so a member sees the admin's plan.
    const status = await resolveSubscriptionStatus(userId);

    return ctx.json(status, 200);
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

    const [data, ownedOrg] = await Promise.all([
      db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: {
          delete_at: true,
          deleted_flag: true,
        },
      }),
      // Owning a team with members blocks deletion (billing anchor). Surfaced here
      // so the UI can explain before the user confirms, not after rejecting.
      db.organization.findUnique({
        where: { created_by: userId },
        select: { _count: { select: { members: true } } },
      }),
    ]);

    if (!data) {
      return ctx.json({ error: "Error getting data" }, 500);
    }

    return ctx.json(
      { data, teamMemberCount: ownedOrg?._count.members ?? 0 },
      200,
    );
  })
  .get("/scopes", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const user = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if (!user) {
        throw Error("User not found");
      }

      if (user.is_gmail) {
        const client = await clerkClient();

        const tokenResponse = await client.users.getUserOauthAccessToken(
          userId,
          "google",
        );

        const googleAccount = tokenResponse.data[0];

        if (!googleAccount?.token) {
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

        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: googleAccount.token });

        let hasGmailAccess = false;
        try {
          await oauth2.request({
            url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          });
          hasGmailAccess = true;
        } catch {
          hasGmailAccess = false;
        }

        if (hasGmailAccess) {
          return ctx.json(
            {
              hasAllScopes: true,
              scopes: requiredScopes,
              missingScopes: [],
            },
            200,
          );
        }

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

        const tokenResponse = await client.users.getUserOauthAccessToken(
          userId,
          "microsoft",
        );

        const microsoftAccount = tokenResponse.data[0];

        if (!microsoftAccount) {
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
      }
    } catch (error) {
      console.error("[scopes] failed:", (error as Error)?.message);
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
      // Owning a team with members makes you their billing anchor; deleting would orphan them.
      // Every user has a solo org by default, so gate on member count, not org existence.
      const ownedOrg = await db.organization.findUnique({
        where: { created_by: userId },
        select: { _count: { select: { members: true } } },
      });
      const memberCount = ownedOrg?._count.members ?? 0;
      if (memberCount > 0) {
        return ctx.json(
          {
            error: `You still have ${memberCount} team member${memberCount === 1 ? "" : "s"}. Remove everyone from your team before you can delete or schedule your account for deletion.`,
            code: "ORG_HAS_MEMBERS",
            memberCount,
          },
          409,
        );
      }

      const subscription = await db.subscription.findFirst({
        where: {
          clerkUserId: userId,
          status: "active",
        },
      });

      // Deactivate watch regardless of subscription status; trial/free users have one too.
      // handleWatchDeactivation swallows its own errors so it never blocks deletion.
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
