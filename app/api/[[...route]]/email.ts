import { decryptDomain, encryptDomain } from "@/lib/encode";
import { getLabelledMails, unsubscribeFromEmail } from "@/lib/gmail";
import { getLabelledMailsOutlook } from "@/lib/outlook";
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

  .get("/thisWeek", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();

    // Calculate start of week (Monday) in UTC
    const day = now.getUTCDay(); // 0 = Sunday
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() + diffToMonday);
    startOfWeek.setUTCHours(0, 0, 0, 0);

    // Fetch emails for this week
    const emails = await db.email_tracked.findMany({
      where: {
        user_id: userId,
        created_at: {
          gte: startOfWeek,
          lte: now,
        },
      },
      select: {
        created_at: true,
      },
    });

    // Initialize counts
    const weekCounts: Record<string, number> = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0,
      Sunday: 0,
    };

    const dayMap = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    // Aggregate using UTC day
    emails.forEach((email) => {
      const dayName = dayMap[email.created_at.getUTCDay()];
      weekCounts[dayName]++;
    });

    return ctx.json(weekCounts);
  })

  .get("/labelsWeek", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();

    const day = now.getUTCDay(); // 0 = Sunday
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const startOfWeek = new Date(now);
    startOfWeek.setUTCDate(now.getUTCDate() + diffToMonday);
    startOfWeek.setUTCHours(0, 0, 0, 0);

    const totalThisWeek = await db.email_tracked.count({
      where: {
        user_id: userId,
        created_at: {
          gte: startOfWeek,
          lte: now,
        },
      },
    });

    const topLabels = await db.email_tracked.groupBy({
      by: ["tag_id"],
      where: {
        user_id: userId,
        created_at: {
          gte: startOfWeek,
          lte: now,
        },
      },
      _count: {
        tag_id: true,
      },
      orderBy: {
        _count: {
          tag_id: "desc",
        },
      },
      take: 4,
    });

    const tagIds = topLabels.map((t) => t.tag_id);

    const tags = await db.tag.findMany({
      where: {
        id: { in: tagIds },
      },
      select: {
        id: true,
        name: true,
        color: true,
      },
    });

    const tagMap = new Map(
      tags.map((tag) => [tag.id, { name: tag.name, color: tag.color }]),
    );

    const labels = topLabels.map((item) => {
      const meta = tagMap.get(item.tag_id);

      const count = item._count.tag_id;
      const percentage =
        totalThisWeek > 0
          ? Number(((count / totalThisWeek) * 100).toFixed(1))
          : 0;

      return {
        label: meta?.name,
        count,
        percentage,
        color: meta?.color,
      };
    });

    return ctx.json(labels);
  })

  .get("/stats", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const [total, readData] = await Promise.all([
      db.email_tracked.groupBy({
        by: ["domain"],
        where: { user_id: userId ,domain: { not: null } },
        _count: { message_id: true },
      }),
      db.email_tracked.groupBy({
        by: ["domain"],
        where: { user_id: userId, is_read: true,domain: { not: null }  },
        _count: { message_id: true },
      }),
    ]);

    const readMap = new Map(
      readData.map((r) => [r.domain, r._count.message_id]),
    );

    const stats = total.map((row) => {
      const totalCount = row._count.message_id;
      const readCount = readMap.get(row.domain) ?? 0;
      const unreadCount = totalCount - readCount;

      return {
        domain: row.domain ? decryptDomain(row.domain) : null,
        rawDomain: row.domain,
        total: totalCount,
        read_count: readCount,
        unread_count: unreadCount,
        unread_percentage:
          totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0,
      };
    });

    return ctx.json(stats);
  })

  .post('/unsubscribe',zValidator(
      "json",
      z.object({
        domain:z.string()
      }),
    ),async(ctx)=>{
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const values = ctx.req.valid("json");

    const messageId = await db.email_tracked.findFirst({
      where:{domain:values.domain},
      select:{
        message_id:true
      }
    })

    if(!messageId){
      return ctx.json({error:"Error unsubscribing from this domain"},500);
    }

    try{
      const response = await unsubscribeFromEmail(userId,messageId.message_id);
      return ctx.json(response, 200);
    }catch(error: any){
      return ctx.json({error: error.message || "Error unsubscribing from this domain"}, 500);
    }
  })

export default app;
