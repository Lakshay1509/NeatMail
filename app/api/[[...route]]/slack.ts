import { auth, clerkClient } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()
  .get("/enabled", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const slackAccount = user.externalAccounts.find(
      (acc) => acc.provider === "oauth_slack",
    );
    
    return ctx.json({ enabled: !!slackAccount }, 200);
  })

  .delete("/", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    const slackAccount = user.externalAccounts.find(
      (acc) => acc.provider === "oauth_slack",
    );

    if (!slackAccount)
      return ctx.json({ error: "No Slack connection found" }, 404);

    await client.users.deleteUserExternalAccount({
      userId,
      externalAccountId: slackAccount.id,
    });

    return ctx.json({ success: true }, 200);
  });

export default app;
