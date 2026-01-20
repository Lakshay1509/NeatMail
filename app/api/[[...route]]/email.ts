import { getLabelledMails } from "@/lib/gmail";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()

  .get("/fetch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const limitQuery = ctx.req.query("limit");
    const cursor = ctx.req.query("cursor");
    const limit = limitQuery ? parseInt(limitQuery) : 5;

    if(limit > 50 || limit< 0){
      return ctx.json({error:"Limit overflow"},500);
    }

    const messageData = await db.email_tracked.findMany({
      where:{user_id:userId},
      orderBy:{
        created_at:'desc'
      },
      select:{
        message_id:true,
        
      },
      take : limit + 1,
      cursor: cursor ? { message_id: cursor } : undefined,
    })

    let nextCursor: string | undefined = undefined;
    if (messageData.length > limit) {
        const nextItem = messageData.pop();
        nextCursor = nextItem?.message_id;
    }

    if(!messageData){
      return ctx.json({error:"Error getting messageId"},500);
    }

    

   const ids = messageData.map(item => item.message_id);


    const emails = await getLabelledMails(userId, ids);

    const foundMessageIds = new Set(emails.map(e => e.messageId));
  const deletedIds = ids.filter(id => !foundMessageIds.has(id));
  
  if (deletedIds.length > 0) {
    await db.email_tracked.deleteMany({
      where: {
        message_id: { in: deletedIds },
        user_id: userId
      }
    });
  }


    return ctx.json({ emails, nextCursor }, 200);
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
      tags.map((tag) => [tag.id, { name: tag.name, color: tag.color }])
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

  .get('/')

export default app;
