import { Hono } from "hono";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { decryptDomain } from "@/lib/encode";

interface TrafficData {
  day_of_week: number;
  hour_of_day: number;
  email_count: number;
}

const app = new Hono()

  // 1. The Clutter Metric (Top Domains to Unsubscribe From)
  .get("/clutter", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const clutterSources = await db.email_tracked.groupBy({
      by: ["domain"],
      where: {
        user_id: userId,
        is_read: false,
        domain: { not: null },
      },
      _count: { message_id: true },
      orderBy: {
        _count: { message_id: "desc" },
      },
      take: 4,
    });

    const clutterData = await Promise.all(
      clutterSources.map(async (source) => ({
        rawDomain: source.domain,
        domain: source.domain ? await decryptDomain(source.domain) : "",
        unreadCount: source._count.message_id,
      }))
    );

    return ctx.json({
      clutterData,
    },200);
  })

  .get("/labelsThisWeek", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

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
        tag_id: {
          not: null,
        },
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
      take: 5,
    });

    const tagIds = topLabels
      .map((t) => t.tag_id)
      .filter((id): id is string => id !== null);

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
      const meta = tagMap.get(item.tag_id!);

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
    .get("/mailsThisMonth", async (ctx) => {
      const { userId } = await auth();
  
      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }
  
      const now = new Date();
  
      const startOfPeriod = new Date(now);
      startOfPeriod.setDate(startOfPeriod.getDate() - 30);
  
      const endOfPeriod = new Date(now);
  
      const data = await db.email_tracked.count({
        where: {
          user_id: userId,
          tag_id: {
            not: null,
          },
          created_at: {
            gte: startOfPeriod,
            lt: endOfPeriod,
          },
        },
      });
  
      return ctx.json({ data }, 200);
    })

  .get("/mailsByDay", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();
    // To calculate growth rate we need previous days too.
    // Let's get 8 days to calculate growth for 7 days.
    const startOfPeriod = new Date(now);
    startOfPeriod.setDate(startOfPeriod.getDate() - 7);
    startOfPeriod.setHours(0, 0, 0, 0);

    const rawData = await db.$queryRaw<{ date_str: string; email_count: number }[]>`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') as date_str,
        CAST(COUNT(*) AS INTEGER) as email_count
      FROM "public"."email_tracked"
      WHERE user_id = ${userId}
        AND tag_id IS NOT NULL
        AND created_at >= ${startOfPeriod}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY date_str ASC;
    `;

    // Map into last 7 days array
    const result = [];
    let previousCount = 0;

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const month = d.toLocaleString("default", { month: "short" });
      const day = d.getDate();
      const label = `${month} ${day}`;

      const matched = rawData.find((r) => r.date_str === dateStr);
      const count = matched ? matched.email_count : 0;

      let timeSaved = count * 5;

      result.push({
        date: label,
        total: count,
        timeSaved: timeSaved,
      });

      previousCount = count;
    }

    return ctx.json({ data: result }, 200);
  })

  // 4. Inbox Traffic / Focus Heatmap (Activity by Day & Hour)
  .get("/traffic-heatmap", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    // Using a raw query to extract Date parts in Postgres.
    // DOW (Day Of Week): 0 = Sunday, 1 = Monday, etc.
    const trafficData = await db.$queryRaw<TrafficData[]>`
      SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        EXTRACT(HOUR FROM created_at) as hour_of_day,
        CAST(COUNT(*) AS INTEGER) as email_count
      FROM "public"."email_tracked"
      WHERE user_id = ${userId}
      GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
      ORDER BY day_of_week, hour_of_day;
    `;

    return ctx.json({trafficData },200);
  });

export default app;
