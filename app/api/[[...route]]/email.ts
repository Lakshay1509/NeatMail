import { getRecentEmails } from "@/lib/gmail";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()

  .get("/fetch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const emails = await getRecentEmails(userId, 15);

    return ctx.json({ emails }, 200);
  })

  .get('/thisWeek', async (ctx) => {
  const { userId } = await auth();

  if (!userId) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  const now = new Date();

  // Calculate start of week (Monday)
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);

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

  // Aggregate
  emails.forEach((email) => {
    const dayName = dayMap[email.created_at.getDay()];
    weekCounts[dayName]++;
  });

  return ctx.json(weekCounts);
});


export default app;
