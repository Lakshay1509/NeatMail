import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { db } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { encrypt } from "@/lib/encode";
import crypto from "crypto";
import z from "zod";
import { getUserTier } from "@/lib/tier-guard";

const SLACK_API = "https://slack.com/api";

const SCOPES = [
  "search:read",
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "users:read",
].join(",");

const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().length(64),
});

const SLACK_ERROR_MAP: Record<string, string> = {
  access_denied: "authorization_denied",
};

const app = new Hono()
  .get("/enabled", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const tier = await getUserTier(userId);
    if (tier === "FREE") return ctx.json({ error: "Upgrade to Pro to access integrations" }, 402);

    const integration = await db.slack_integration.findUnique({
      where: { user_id: userId },
    });

    return ctx.json({ enabled: !!integration }, 200);
  })

  .get("/authorize", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const tier = await getUserTier(userId);
    if (tier === "FREE") return ctx.json({ error: "Upgrade to Pro to access integrations" }, 402);

    const state = crypto.randomBytes(32).toString("hex");
    await redis.setex(`slack_oauth_state:${state}`, 600, userId);

    const clientId = process.env.SLACK_CLIENT_ID!;
    const redirectUri = process.env.SLACK_REDIRECT_URI!;

    const params = new URLSearchParams({
      client_id: clientId,
      user_scope: SCOPES,
      redirect_uri: redirectUri,
      state,
    });

    return ctx.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
  })

  .get("/callback", async (ctx) => {
    const query = ctx.req.query();
    const { error: slackError } = query;

    if (slackError) {
      const reason = SLACK_ERROR_MAP[slackError] ?? "authorization_denied";
      return ctx.redirect(`/integrations?slack=error&reason=${reason}`);
    }

    const parsed = CallbackQuery.safeParse(query);
    if (!parsed.success) {
      return ctx.redirect("/integrations?slack=error&reason=invalid_params");
    }

    const { code, state } = parsed.data;

    const userId = await redis.get(`slack_oauth_state:${state}`);
    if (!userId) {
      return ctx.redirect("/integrations?slack=error&reason=expired_or_invalid_state");
    }

    await redis.del(`slack_oauth_state:${state}`);

    const clientId = process.env.SLACK_CLIENT_ID!;
    const clientSecret = process.env.SLACK_CLIENT_SECRET!;
    const redirectUri = process.env.SLACK_REDIRECT_URI!;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[Slack] OAuth exchange failed:", data);
      const reason = SLACK_ERROR_MAP[data.error] ?? "exchange_failed";
      return ctx.redirect(`/integrations?slack=error&reason=${reason}`);
    }

    const userToken = data.authed_user?.access_token;
    if (!userToken) {
      console.error("[Slack] No user token in response:", data);
      return ctx.redirect("/integrations?slack=error&reason=no_user_token");
    }

    const [encryptedToken, encryptedRefresh] = await Promise.all([
      encrypt(userToken),
      data.authed_user?.refresh_token
        ? encrypt(data.authed_user.refresh_token)
        : Promise.resolve(null),
    ]);

    await db.slack_integration.upsert({
      where: { user_id: userId },
      update: {
        access_token: encryptedToken,
        refresh_token: encryptedRefresh,
        token_expires_at: data.authed_user?.expires_in
          ? new Date(Date.now() + data.authed_user.expires_in * 1000)
          : null,
      },
      create: {
        user_id: userId,
        access_token: encryptedToken,
        refresh_token: encryptedRefresh,
        token_expires_at: data.authed_user?.expires_in
          ? new Date(Date.now() + data.authed_user.expires_in * 1000)
          : null,
      },
    });

    return ctx.redirect("/integrations?slack=connected");
  })

  .delete("/", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const tier = await getUserTier(userId);
    if (tier === "FREE") return ctx.json({ error: "Upgrade to Pro to access integrations" }, 402);

    const integration = await db.slack_integration.findUnique({
      where: { user_id: userId },
    });

    if (!integration) {
      return ctx.json({ error: "No Slack connection found" }, 404);
    }

    await db.slack_integration.delete({
      where: { user_id: userId },
    });

    return ctx.json({ success: true }, 200);
  });

export default app;
