import { Hono } from "hono";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { decryptDomain } from "@/lib/encode";
import z from "zod";

interface TrafficData {
  day_of_week: number;
  hour_of_day: number;
  email_count: number;
}

const dateQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/).optional(),
});

const app = new Hono()

  // 1. The Clutter Metric (Top Domains to Unsubscribe From)
  .get("/clutter", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }
    const dateFilter: any = {};
    if (fromStr) dateFilter.gte = new Date(fromStr);
    if (toStr) dateFilter.lte = new Date(toStr);

    const clutterSources = await db.email_tracked.groupBy({
      by: ["domain"],
      where: {
        user_id: userId,
        is_read: false,
        domain: { not: null },
        ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
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
    }, 200);
  })

  .get('/mostEmails', async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }
    const dateFilter: any = {};
    if (fromStr) dateFilter.gte = new Date(fromStr);
    if (toStr) dateFilter.lte = new Date(toStr);

    const topSenders = await db.email_tracked.groupBy({
      by: ["domain"],
      where: {
        user_id: userId,
        domain: { not: null },
        ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
      },
      _count: { message_id: true },
      orderBy: {
        _count: { message_id: "desc" },
      },
      take: 3,
    });

    const mostEmailsData = await Promise.all(
      topSenders.map(async (source) => ({
        rawDomain: source.domain,
        domain: source.domain ? await decryptDomain(source.domain) : "",
        count: source._count.message_id,
      }))
    );

    return ctx.json({
      mostEmailsData,
    }, 200);
  })

  .get("/labelsThisWeek", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const fromDate = fromStr ? new Date(fromStr) : startOfWeek;
    const toDate = toStr ? new Date(toStr) : now;

    const totalThisWeek = await db.email_tracked.count({
      where: {
        user_id: userId,
        created_at: {
          gte: fromDate,
          lte: toDate,
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
          gte: fromDate,
          lte: toDate,
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

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const now = new Date();

    let startOfPeriod = new Date(now);
    startOfPeriod.setDate(startOfPeriod.getDate() - 7);
    let endOfPeriod = new Date(now);

    if (fromStr) startOfPeriod = new Date(fromStr);
    if (toStr) endOfPeriod = new Date(toStr);


    const currentCount = await db.email_tracked.count({
      where: {
        user_id: userId,
        created_at: {
          gte: startOfPeriod,
          lte: endOfPeriod,
        },
      },
    });

    const unreadCount = await db.email_tracked.count({
      where: {
        user_id: userId,
        is_read: false,
        created_at: {
          gte: startOfPeriod,
          lte: endOfPeriod,
        },
      },
    });



    return ctx.json(
      {
        current: currentCount,
        unreadCount: unreadCount,


      },
      200
    );
  })


  // 4. Inbox Traffic / Focus Heatmap (Activity by Day & Hour)
  .get("/traffic-heatmap", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    let trafficData: TrafficData[] = [];

    if (fromStr || toStr) {
      const startOfPeriod = fromStr ? new Date(fromStr) : new Date(0);
      const endOfPeriod = toStr ? new Date(toStr) : new Date();

      trafficData = await db.$queryRaw<TrafficData[]>`
        SELECT 
          EXTRACT(DOW FROM created_at) as day_of_week,
          EXTRACT(HOUR FROM created_at) as hour_of_day,
          CAST(COUNT(*) AS INTEGER) as email_count
        FROM "public"."email_tracked"
        WHERE user_id = ${userId}
          AND created_at >= ${startOfPeriod} 
          AND created_at <= ${endOfPeriod}
        GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
        ORDER BY day_of_week, hour_of_day;
      `;
    } else {
      trafficData = await db.$queryRaw<TrafficData[]>`
        SELECT 
          EXTRACT(DOW FROM created_at) as day_of_week,
          EXTRACT(HOUR FROM created_at) as hour_of_day,
          CAST(COUNT(*) AS INTEGER) as email_count
        FROM "public"."email_tracked"
        WHERE user_id = ${userId}
        GROUP BY EXTRACT(DOW FROM created_at), EXTRACT(HOUR FROM created_at)
        ORDER BY day_of_week, hour_of_day;
      `;
    }

    return ctx.json({ trafficData }, 200);
  })

  // 5. Read vs Unread over the last 7 days
  .get("/readVsUnread", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const now = new Date();
    // Go back 6 days to get 7 days total including today
    let endOfPeriod = new Date(now);
    let startOfPeriod = new Date(now);
    startOfPeriod.setDate(startOfPeriod.getDate() - 6);
    startOfPeriod.setHours(0, 0, 0, 0);

    if (fromStr) startOfPeriod = new Date(fromStr);
    if (toStr) endOfPeriod = new Date(toStr);

    // Grouping by Date and Read Status
    const rawData = await db.$queryRaw<{ date_str: string; is_read: boolean; email_count: number }[]>`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM-DD') as date_str,
        "isRead" as is_read,
        CAST(COUNT(*) AS INTEGER) as email_count
      FROM "public"."email_tracked"
      WHERE user_id = ${userId}
        AND created_at >= ${startOfPeriod}
        AND created_at <= ${endOfPeriod}
      GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD'), "isRead"
      ORDER BY date_str ASC;
    `;

    const result = [];
    const daysDiff = Math.max(1, Math.ceil((endOfPeriod.getTime() - startOfPeriod.getTime()) / (1000 * 60 * 60 * 24)));

    // Ensure we send back a dense array of exact days
    for (let i = daysDiff - 1; i >= 0; i--) {
      const d = new Date(endOfPeriod);
      d.setDate(d.getDate() - i);

      const dateStr = d.toISOString().split("T")[0];
      const month = d.toLocaleString("default", { month: "short" });
      const day = d.getDate();
      const label = `${month} ${day}`;

      let readCount = 0;
      let unreadCount = 0;

      for (const row of rawData) {
        if (row.date_str === dateStr) {
          if (row.is_read) {
            readCount = row.email_count;
          } else {
            unreadCount = row.email_count;
          }
        }
      }

      result.push({
        date: label,
        fullDate: dateStr,
        read: readCount,
        unread: unreadCount,
        total: readCount + unreadCount,
      });
    }

    return ctx.json({ data: result }, 200);
  })

  // 6. Overview KPIs with period-over-period deltas
  .get("/overview", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const now = new Date();
    let start = new Date(now);
    start.setDate(start.getDate() - 7);
    let end = new Date(now);
    if (fromStr) start = new Date(fromStr);
    if (toStr) end = new Date(toStr);

    // Previous window of equal length, immediately preceding [start, end]
    const windowMs = Math.max(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - windowMs);

    const [current, currentUnread, previous, previousUnread] = await Promise.all([
      db.email_tracked.count({
        where: { user_id: userId, created_at: { gte: start, lte: end } },
      }),
      db.email_tracked.count({
        where: { user_id: userId, is_read: false, created_at: { gte: start, lte: end } },
      }),
      db.email_tracked.count({
        where: { user_id: userId, created_at: { gte: prevStart, lt: prevEnd } },
      }),
      db.email_tracked.count({
        where: { user_id: userId, is_read: false, created_at: { gte: prevStart, lt: prevEnd } },
      }),
    ]);

    const readRate =
      current > 0
        ? Number((((current - currentUnread) / current) * 100).toFixed(1))
        : 0;
    const previousReadRate =
      previous > 0
        ? Number((((previous - previousUnread) / previous) * 100).toFixed(1))
        : 0;

    return ctx.json(
      {
        current,
        previous,
        unread: currentUnread,
        previousUnread,
        readRate,
        previousReadRate,
      },
      200
    );
  })

  // 7. Unread breakdown by label — how unread emails are distributed across tags
  .get("/unread-by-label", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) return ctx.json({ error: "Invalid date format." }, 400);

    const dateFilter: any = {};
    if (fromStr) dateFilter.gte = new Date(fromStr);
    if (toStr) dateFilter.lte = new Date(toStr);
    const createdAt = Object.keys(dateFilter).length > 0 ? { created_at: dateFilter } : {};

    const base = { user_id: userId, is_read: false, ...createdAt };

    const [total, grouped] = await Promise.all([
      db.email_tracked.count({ where: base }),
      db.email_tracked.groupBy({
        by: ["tag_id"],
        where: base,
        _count: { message_id: true },
        orderBy: { _count: { message_id: "desc" } },
        take: 7,
      }),
    ]);

    if (total === 0) return ctx.json({ total: 0, breakdown: [] }, 200);

    const tagIds = grouped
      .map((g) => g.tag_id)
      .filter((id): id is string => id !== null);

    const tags = await db.tag.findMany({
      where: { id: { in: tagIds } },
      select: { id: true, name: true, color: true },
    });
    const tagMap = new Map(tags.map((t) => [t.id, t]));

    const breakdown = grouped.map((g) => {
      const tag = g.tag_id ? tagMap.get(g.tag_id) : null;
      return {
        label: tag?.name ?? "Unlabeled",
        count: g._count.message_id,
        color: tag?.color ?? "#64748b",
      };
    });

    return ctx.json({ total, breakdown }, 200);
  })

  // 8. Email status breakdown — where every email stands (mutually exclusive)
  .get("/email-status", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }

    const dateFilter: any = {};
    if (fromStr) dateFilter.gte = new Date(fromStr);
    if (toStr) dateFilter.lte = new Date(toStr);
    const createdAt =
      Object.keys(dateFilter).length > 0 ? { created_at: dateFilter } : {};

    const now = new Date();
    const base = { user_id: userId, ...createdAt };
    // Not actively snoozed: snooze unset or already elapsed
    const notSnoozed = {
      OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }],
    };

    // Buckets are mutually exclusive by priority: snoozed > done > archived > unread > read
    const [total, snoozed, done, archived, unread] = await Promise.all([
      db.email_tracked.count({ where: { ...base } }),
      db.email_tracked.count({
        where: { ...base, snoozed_until: { gt: now } },
      }),
      db.email_tracked.count({
        where: { ...base, isDone: true, ...notSnoozed },
      }),
      db.email_tracked.count({
        where: {
          ...base,
          isDone: false,
          archive_at: { not: null },
          ...notSnoozed,
        },
      }),
      db.email_tracked.count({
        where: {
          ...base,
          isDone: false,
          archive_at: null,
          is_read: false,
          ...notSnoozed,
        },
      }),
    ]);

    const read = Math.max(total - snoozed - done - archived - unread, 0);

    return ctx.json({ total, done, snoozed, archived, unread, read }, 200);
  });

export default app;
