import { decryptDomain, encryptDomain } from "@/lib/encode";
import {
  getLabelledMails,
  unsubscribeFromEmail,
  getPreviousMails,
  getFilteredMails,
  trashMessages,
} from "@/lib/gmail";
import {
  getLabelledMailsOutlook,
  getPreviousOutlookMails,
  unsubscribeFromEmailOutlook,
} from "@/lib/outlook";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

const dateQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/).optional(),
});

const filteredQuerySchema = z.object({
  after: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/),
  largerThan: z.coerce.number().int().positive(),
  from: z.string().optional(),
  to: z.string().optional(),
});

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

    const fromStr = ctx.req.query("from");
    const toStr = ctx.req.query("to");
    const dateQuery = dateQuerySchema.safeParse({ from: fromStr, to: toStr });
    if (!dateQuery.success) {
      return ctx.json({ error: "Invalid date format. Use YYYY-MM-DD." }, 400);
    }
    const dateFilter: any = {};
    if (fromStr) dateFilter.gte = new Date(fromStr);
    if (toStr) dateFilter.lte = new Date(toStr);

    const [total, readData, archiveRules] = await Promise.all([
      db.email_tracked.groupBy({
        by: ["domain"],
        where: {
          user_id: userId,
          domain: { not: null },
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
        },
        _count: { message_id: true },
      }),
      db.email_tracked.groupBy({
        by: ["domain"],
        where: {
          user_id: userId,
          is_read: true,
          domain: { not: null },
          ...(Object.keys(dateFilter).length > 0 && { created_at: dateFilter }),
        },
        _count: { message_id: true },
      }),
      db.archiveRule.findMany({
        where: { user_id: userId },
        select: { domain: true, isActive: true, archiveAfterDays: true },
      }),
    ]);

    const readMap = new Map(
      readData.map((r) => [r.domain, r._count.message_id]),
    );

    const archiveMap = new Map(
      archiveRules.map((r) => [
        r.domain,
        { isActive: r.isActive, days: r.archiveAfterDays },
      ]),
    );

    const stats = await Promise.all(
      total.map(async (row) => {
        const totalCount = row._count.message_id;
        const readCount = readMap.get(row.domain) ?? 0;
        const unreadCount = totalCount - readCount;
        const archiveSetting = row.domain
          ? archiveMap.get(row.domain)
          : undefined;

        return {
          domain: row.domain ? await decryptDomain(row.domain) : null,
          rawDomain: row.domain,
          total: totalCount,
          read_count: readCount,
          unread_count: unreadCount,
          unread_percentage:
            totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0,
          is_archived: archiveSetting?.isActive ?? false,
          archive_after_days: archiveSetting?.days ?? null,
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
      } catch (_error) {
        return ctx.json({ error: "Error unsubscribing from this domain" }, 500);
      }
    },
  )

  .post(
    "/archive",
    zValidator(
      "json",
      z.object({
        domain: z.string(),
        enabled: z.boolean(),
        duration: z.union([z.literal(30), z.literal(60)]),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const data = await db.$transaction(async (tx) => {
        const updatedData = await db.archiveRule.upsert({
          where: {
            user_id_domain: {
              user_id: userId,
              domain: values.domain,
            },
          },
          update: {
            isActive: values.enabled,
            archiveAfterDays: values.duration,
          },
          create: {
            user_tokens: {
              connect: { clerk_user_id: userId },
            },
            domain: values.domain,
            isActive: values.enabled,
            archiveAfterDays: values.duration,
          },
        });
        return updatedData;
      });

      if (!data) {
        return ctx.json({ error: "Error creating auto archive" }, 500);
      }

      return ctx.json({ data }, 200);
    },
  )

  .post("/sync-history", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const is_gmail = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true },
    });

    if (!is_gmail?.is_gmail) {
      const is_outlook = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { outlook_id: true },
      });

      if (is_outlook?.outlook_id) {
        try {
          const mails = await getPreviousOutlookMails(userId);

          if (!mails || mails.length === 0) {
            return ctx.json({ message: "No mails found" }, 200);
          }

          const insertData = await Promise.all(
            mails.map(async (mail) => {
              const domain = await encryptDomain(mail.fullemail);
              return {
                user_id: userId,
                message_id: mail.messageId,
                domain,
                is_read: mail.is_Read,
                created_at: new Date(mail.created_at),
              };
            }),
          );

          await db.email_tracked.createMany({
            data: insertData,
            skipDuplicates: true,
          });

          return ctx.json(
            {
              message: "History synced successfully",
              count: insertData.length,
            },
            200,
          );
        } catch (error) {
          console.error("Error syncing history (Outlook):", error);
          return ctx.json({ error: "Failed to sync history" }, 500);
        }
      }

      return ctx.json(
        { error: "Failed to sync history for outlook, unable to find outlook id for user" },
        400,
      );
    }

    try {
      const mails = await getPreviousMails(userId);

      if (!mails || mails.length === 0) {
        return ctx.json({ message: "No mails found" }, 200);
      }

      const insertData = await Promise.all(
        mails.map(async (mail) => {
          const domain = await encryptDomain(mail.senderEmail);

          return {
            user_id: userId,
            message_id: mail.messageId,
            domain,
            is_read: mail.is_read,
            created_at: new Date(mail.date),
          };
        }),
      );

      await db.email_tracked.createMany({
        data: insertData,
        skipDuplicates: true,
      });

      return ctx.json(
        {
          message: "History synced successfully",
          count: insertData.length,
        },
        200,
      );
    } catch (error) {
      console.error("Error syncing history:", error);

      return ctx.json({ error: "Failed to sync history for gmail" }, 500);
    }
  })

  .get("/filtered", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const query = filteredQuerySchema.safeParse(ctx.req.query());
    if (!query.success) {
      return ctx.json({ error: z.treeifyError(query.error) }, 400);
    }
    
    const emails = await getFilteredMails(userId, query.data);
    return ctx.json({ emails }, 200);
  })

  .post('/deleteMessage', zValidator(
      "json",
      z.object({
        messageId:z.string()
      }),
    ),async(ctx)=>{

     const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }
    const values = ctx.req.valid("json");

    const response = await trashMessages(userId,[values.messageId])

    if(response.error){
      return ctx.json({error:"Error deleting this message"},500);
    }

    return ctx.json({response},200);


  })

export default app;
