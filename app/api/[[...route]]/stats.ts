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
      take: 3,
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

  // 2. Category Engagement (Read Rate by Category)
  .get("/category-engagement", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    // Fetch read vs unread counts grouped by tag
    const stats = await db.email_tracked.groupBy({
      by: ["tag_id", "is_read"],
      where: { user_id: userId },
      _count: { message_id: true },
    });

    // Fetch tag details to enrich the response
    const tags = await db.tag.findMany({
     where: {
        OR: [{ user_id: userId }, { user_id: null }],
      },
      select: { id: true, name: true, color: true },
    });

    // Calculate read rates per tag
    const engagement = tags.map((tag) => {
      const readCount =
        stats.find((s) => s.tag_id === tag.id && s.is_read)?._count
          .message_id || 0;
      const unreadCount =
        stats.find((s) => s.tag_id === tag.id && !s.is_read)?._count
          .message_id || 0;
      const total = readCount + unreadCount;

      return {
        tagId: tag.id,
        name: tag.name,
        color: tag.color,
        readCount,
        unreadCount,
        total,
        readRate: total > 0 ? ((readCount / total) * 100).toFixed(1) : 0,
      };
    });

    return ctx.json({ engagement },200);
  })

  // 3. Estimated "Time Saved" by AI (The ROI Metric)
  .get("/time-saved", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    // Assumption: Each email processed/labeled by AI saves about 5 seconds of manual sorting
    const SECONDS_SAVED_PER_EMAIL = 5;

    const totalProcessed = await db.email_tracked.count({
      where: { user_id: userId },
    });

    const totalSecondsSaved = totalProcessed * SECONDS_SAVED_PER_EMAIL;

    // Format into easily consumable metrics for the frontend
    const hours = Math.floor(totalSecondsSaved / 3600);
    const minutes = Math.floor((totalSecondsSaved % 3600) / 60);

    return ctx.json({
      totalEmailsProcessed: totalProcessed,
      estimatedTimeSaved: {
        hours,
        minutes,
        totalSeconds: totalSecondsSaved,
      },
    },200);
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
