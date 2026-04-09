import { decryptDomain, encryptDomain } from "@/lib/encode";
import { getLabelledMails, unsubscribeFromEmail } from "@/lib/gmail";
import {
  getLabelledMailsOutlook,
  unsubscribeFromEmailOutlook,
} from "@/lib/outlook";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

const app = new Hono()

  //this route is for landing page

  .get("/all", async (ctx) => {
    const data = await db.email_tracked.count();

    if (!data) {
      return ctx.json({ error: "Error getting data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/fetch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const limitQuery = ctx.req.query("limit");
    const cursor = ctx.req.query("cursor");
    const limit = limitQuery ? parseInt(limitQuery) : 5;

    if (limit > 50 || limit < 0) {
      return ctx.json({ error: "Limit overflow" }, 500);
    }

    const userData = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
    });

    if (!userData) {
      return ctx.json({ error: "Error getting user data" }, 500);
    }

    const messageData = await db.email_tracked.findMany({
      where: { user_id: userId },
      orderBy: {
        created_at: "desc",
      },
      select: {
        message_id: true,
        user_tokens: {
          select: {
            is_gmail: true,
          },
        },
      },
      take: limit + 1,
      cursor: cursor ? { message_id: cursor } : undefined,
    });

    let nextCursor: string | undefined = undefined;
    if (messageData.length > limit) {
      const nextItem = messageData.pop();
      nextCursor = nextItem?.message_id;
    }

    if (!messageData) {
      return ctx.json({ error: "Error getting messageId" }, 500);
    }

    const ids = messageData.map((item) => item.message_id);

    if (userData.is_gmail === true) {
      const emails = await getLabelledMails(userId, ids);
      return ctx.json({ emails, nextCursor }, 200);
    } else {
      const emails = await getLabelledMailsOutlook(userId, ids);
      return ctx.json({ emails, nextCursor }, 200);
    }
  })

  .get("/stats", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const [total, readData] = await Promise.all([
      db.email_tracked.groupBy({
        by: ["domain"],
        where: { user_id: userId, domain: { not: null } },
        _count: { message_id: true },
      }),
      db.email_tracked.groupBy({
        by: ["domain"],
        where: { user_id: userId, is_read: true, domain: { not: null } },
        _count: { message_id: true },
      }),
    ]);

    const readMap = new Map(
      readData.map((r) => [r.domain, r._count.message_id]),
    );

    const stats = await Promise.all(
      total.map(async (row) => {
        const totalCount = row._count.message_id;
        const readCount = readMap.get(row.domain) ?? 0;
        const unreadCount = totalCount - readCount;

        return {
          domain: row.domain ? await decryptDomain(row.domain) : null,
          rawDomain: row.domain,
          total: totalCount,
          read_count: readCount,
          unread_count: unreadCount,
          unread_percentage:
            totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0,
        };
      }),
    );

    return ctx.json(stats);
  })

  .post(
    "/unsubscribe",
    zValidator(
      "json",
      z.object({
        domain: z.string(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const messageId = await db.email_tracked.findFirst({
        where: { domain: values.domain, user_id: userId },
        select: {
          message_id: true,
        },
      });

      const is_gmail = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if (!messageId || !is_gmail) {
        return ctx.json({ error: "Error unsubscribing from this domain" }, 500);
      }

      try {
        if (is_gmail?.is_gmail === true) {
          const response = await unsubscribeFromEmail(
            userId,
            messageId.message_id,
          );
          return ctx.json(response, 200);
        } else {
          const response = await unsubscribeFromEmailOutlook(
            userId,
            messageId.message_id,
          );
          return ctx.json(response, 200);
        }
      } catch (error: any) {
        return ctx.json(
          { error: error.message || "Error unsubscribing from this domain" },
          500,
        );
      }
    },
  );

export default app;
