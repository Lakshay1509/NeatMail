import { Hono } from "hono";

import { db } from "@/lib/prisma";
import { clerkClient } from "@clerk/nextjs/server";

const app = new Hono().get("/delete-user", async (ctx) => {
  const authHeader = ctx.req.header("x-authorization");
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedToken) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

 

  try {

    const clerk = clerkClient()
    
    const usersToDelete = await db.user_tokens.findMany({
      where: {
        deleted_flag: true,
        delete_at: {
          lte: new Date(), 
        },
      },
    });

    const results = {
      total: usersToDelete.length,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    
    for (const user of usersToDelete) {
      try {
        
        await (await clerk).users.deleteUser(user.clerk_user_id);

        
        await db.user_tokens.delete({
          where: {
            clerk_user_id: user.clerk_user_id,
          },
        });

        results.successful++;
        console.log(`Successfully deleted user: ${user.clerk_user_id}`);
      } catch (error) {
        results.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.errors.push(
          `Failed to delete user ${user.clerk_user_id}: ${errorMessage}`
        );
        console.error(`Failed to delete user ${user.clerk_user_id}:`, error);
      }
    }

    return ctx.json({
      message: "User deletion completed",
      timestamp: new Date().toISOString(),
      ...results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return ctx.json(
      { 
        error: "Internal server error", 
        details: errorMessage 
      },
      500
    );
  } 
});

export default app;