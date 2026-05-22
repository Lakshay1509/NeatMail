import { Hono } from "hono";
import { auth, clerkClient } from "@clerk/nextjs/server";

const app = new Hono()
  .get("/:provider", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const provider = ctx.req.param("provider");
    const clerkProvider = `oauth_${provider}`;

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const isConnected = user.externalAccounts.some(
      (acc) => acc.provider === clerkProvider,
    );

    return ctx.json({ enabled: isConnected, provider }, 200);
  })

  .post("/:provider/disable", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const provider = ctx.req.param("provider");
    const clerkProvider = `oauth_${provider}`;
    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const externalAccount = user.externalAccounts.find(
      (acc) => acc.provider === clerkProvider,
    );
    if (!externalAccount) {
      return ctx.json({ error: "Integration not found" }, 404);
    }

    await client.users.deleteUserExternalAccount({
      userId,
      externalAccountId: externalAccount.id,
    });

    return ctx.json({ success: true, provider }, 200);
  });

export default app;
