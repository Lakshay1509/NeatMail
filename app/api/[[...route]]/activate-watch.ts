import { activateWatch, deactivateWatch } from "@/lib/gmail";
import {
  createOutlookSubscription,
  deleteOutlookSubscription,
} from "@/lib/outlook";
import { db } from "@/lib/prisma";
import {
  activeFolder,
  updateHistoryId,
  updateOutlookId,
} from "@/lib/supabase";
import { getUserTier } from "@/lib/tier-guard";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()
  .post("/", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const userTier = await getUserTier(userId);
      if (userTier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to activate watch" }, 403);
      }

      const userData = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true, email: true },
      });

      if (!userData) {
        return ctx.json({ error: "Error getting user data" }, 500);
      }

      if (userData.is_gmail === true) {
        const response = await activateWatch(userId);
        if (!response) {
          return ctx.json({ error: "Error setting up Gmail watch" }, 500);
        }
        await updateHistoryId(userData.email, response.history_id, true);
        return ctx.json({ success: true, historyId: response.history_id }, 200);
      } else {
        const activeFolderData = await activeFolder(userId);

        const foldersData = activeFolderData
          .filter((folder) => folder.isActive === true)
          .map((folder) => ({
            id: folder.id,
            name: folder.name,
          }));

        const response = await createOutlookSubscription(userId,foldersData);

        if (!response) {
          return ctx.json({ error: "Error setting up outlook watch" }, 500);
        }
        await updateOutlookId(userData.email, response.map(r => r.id).join(","), true);

        return ctx.json({ success: true, ids: response.map(r => r.id).join(",") }, 200);
      }
    } catch (error) {
      console.error("❌ Error activating watch:", error);
      return ctx.json(
        {
          error: "Failed to activate watch",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  })

  .post("/deactivate", async (ctx) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const userData = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true, email: true },
      });

      if (!userData) {
        return ctx.json({ error: "Error getting user data" }, 500);
      }

      if (userData.is_gmail === true) {
        const response = await deactivateWatch(userId);
        if (!response) {
          return ctx.json({ error: "Error deleting up Gmail watch" }, 500);
        }
        await updateHistoryId(userData.email, null, false);
        return ctx.json({ success: true }, 200);
      } else {
        const response = await deleteOutlookSubscription(userId);

        if (!response) {
          return ctx.json({ error: "Error deleting up outlook watch" }, 500);
        }
        await updateOutlookId(userData.email, null, false);

        return ctx.json({ success: true }, 200);
      }
    } catch (error) {
      console.error("❌ Error deactivating watch:", error);
      return ctx.json(
        {
          error: "Failed to deactivate watch",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  });

export default app;
