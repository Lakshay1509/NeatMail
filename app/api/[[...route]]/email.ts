import { decryptDomain, encryptDomain } from "@/lib/encode";
import {
  getLabelledMails,
  getSentEmails,
  getLastSentMessageInThreadGmail,
  unsubscribeFromEmail,
  getPreviousMails,
  getFilteredMails,
  trashMessages,
  replyToGmailThread,
  getGmailMessageBody,
} from "@/lib/gmail";
import {
  deleteOutlookMessage,
  getFilteredMailsOutlook,
  getLabelledMailsOutlook,
  getLastSentMessageInThreadOutlook,
  getPreviousOutlookMails,
  getSentEmailsOutlook,
  unsubscribeFromEmailOutlook,
  replyToOutlookConversation,
  getOutlookMessageBody,
} from "@/lib/outlook";
import { db } from "@/lib/prisma";
import { archiveBacklogQueue } from "@/lib/queue";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { checkFeatureLimit, getUserTier } from "@/lib/tier-guard";
import z from "zod";

const dateQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/)
    .optional(),
});

const filteredQuerySchema = z.object({
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/),
  largerThan: z.coerce.number().int().positive(),
  from: z.string().optional(),
  to: z.string().optional(),
  pageToken: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(500).optional(),
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

    const tier = await getUserTier(userId);
    if (tier === "FREE") {
      return ctx.json({ error: "Upgrade to Pro to access tracked emails" }, 402);
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

    const tier = await getUserTier(userId);
    if (tier === "FREE") {
      return ctx.json({ error: "Upgrade to Pro to access email analytics" }, 402);
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

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to use this feature" }, 403);
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
        if (_error instanceof Error && _error.message.includes("deleted or moved")) {
          return ctx.json({ error: "Message already deleted or moved" }, 200);
        }
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

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to use archive rules" }, 403);
      }

      const values = ctx.req.valid("json");

      const existingRule = await db.archiveRule.findUnique({
        where: {
          user_id_domain: {
            user_id: userId,
            domain: values.domain,
          },
        },
      });

      if (!existingRule) {
        const ruleCount = await db.archiveRule.count({
          where: { user_id: userId },
        });

        const limitCheck = await checkFeatureLimit(userId, "maxArchiveRules", ruleCount);

        if (!limitCheck.allowed) {
          return ctx.json({ error: limitCheck.reason }, 402);
        }
      }

      const data = await db.$transaction(async (tx) => {
        const updatedData = await tx.archiveRule.upsert({
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

  // Tag-scoped archive rules — same sweep and behaviour as domain rules, just
  // finer-grained durations since label rules target shorter-lived mail.
  .put(
    "/archive/tag",
    zValidator(
      "json",
      z.object({
        tagId: z.string().uuid(),
        enabled: z.boolean(),
        duration: z.union([
          z.literal(1),
          z.literal(3),
          z.literal(7),
          z.literal(14),
          z.literal(30),
          z.literal(60),
        ]),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const values = ctx.req.valid("json");

      // FREE users must still be able to turn a rule off after a plan lapses.
      if (values.enabled) {
        const tier = await getUserTier(userId);
        if (tier === "FREE") {
          return ctx.json({ error: "Upgrade to Pro to use archive rules" }, 403);
        }
      }

      // Allow the user's own tags plus shared system presets (user_id null),
      // so a user can't attach a rule to someone else's custom label.
      const tag = await db.tag.findFirst({
        where: {
          id: values.tagId,
          OR: [{ user_id: userId }, { user_id: null }],
        },
        select: { id: true },
      });

      if (!tag) {
        return ctx.json({ error: "Label not found" }, 404);
      }

      const existingRule = await db.archiveRule.findUnique({
        where: {
          user_id_tag_id: {
            user_id: userId,
            tag_id: values.tagId,
          },
        },
      });

      // Domain and tag rules share the one maxArchiveRules allowance.
      if (!existingRule) {
        const ruleCount = await db.archiveRule.count({
          where: { user_id: userId },
        });

        const limitCheck = await checkFeatureLimit(
          userId,
          "maxArchiveRules",
          ruleCount,
        );

        if (!limitCheck.allowed) {
          return ctx.json({ error: limitCheck.reason }, 402);
        }
      }

      // A rule "widens" when it newly exposes existing mail: off→on, first
      // creation, or shortening the window on an active rule. Only a widening
      // triggers the immediate backlog sweep.
      const wasActive = existingRule?.isActive === true;
      const shortened =
        wasActive && !!existingRule && values.duration < existingRule.archiveAfterDays;
      const widensBacklog = values.enabled && (!wasActive || shortened);

      // Only promote SEEDED to USER when we're actually sweeping the backlog,
      // so an untouched SEEDED rule keeps its future-only floor.
      const data = await db.archiveRule.upsert({
        where: {
          user_id_tag_id: {
            user_id: userId,
            tag_id: values.tagId,
          },
        },
        update: {
          isActive: values.enabled,
          archiveAfterDays: values.duration,
          ...(widensBacklog ? { source: "USER" as const } : {}),
        },
        create: {
          user_tokens: { connect: { clerk_user_id: userId } },
          tag: { connect: { id: values.tagId } },
          isActive: values.enabled,
          archiveAfterDays: values.duration,
          source: "USER",
        },
      });

      if (!data) {
        return ctx.json({ error: "Error creating auto archive" }, 500);
      }

      // Best-effort: sweep now instead of waiting for the cron. A failed
      // enqueue shouldn't fail the save — the cron will catch up regardless.
      if (widensBacklog) {
        try {
          // Stable jobId dedupes a double-click or an overlapping cron run.
          await archiveBacklogQueue.add(
            "sweep-tag-backlog",
            { userId, tagId: values.tagId },
            { jobId: `sweep:${userId}:${values.tagId}` },
          );
        } catch (err) {
          console.error("Failed to enqueue archive backlog sweep:", err);
        }
      }

      return ctx.json({ data }, 200);
    },
  )

  // Backs the per-label auto-archive state in the labels UI.
  .get("/archive/tag", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const rules = await db.archiveRule.findMany({
      where: { user_id: userId, tag_id: { not: null } },
      select: {
        tag_id: true,
        isActive: true,
        archiveAfterDays: true,
      },
    });

    return ctx.json({ data: rules }, 200);
  })

  // Count of mail this rule would sweep on save, so the dialog can warn first.
  // Mirrors the cron's USER-rule query — no SEEDED arrival floor.
  .get(
    "/archive/tag/preview",
    zValidator(
      "query",
      z.object({
        tagId: z.string().uuid(),
        duration: z.coerce.number().int().positive(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const { tagId, duration } = ctx.req.valid("query");

      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - duration);

      const count = await db.email_tracked.count({
        where: {
          user_id: userId,
          tag_id: tagId,
          created_at: { lt: thresholdDate },
          archive_at: null,
        },
      });

      return ctx.json({ count }, 200);
    },
  )

  .post("/sync-history", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const tier = await getUserTier(userId);
    if (tier === "FREE") {
      return ctx.json({ error: "Upgrade to Pro to sync email history" }, 403);
    }

    const user = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { email: true, is_gmail: true, outlook_id: true },
    });

    if (process.env.GOOGLE_VERIFICATION_EMAIL && user?.email === process.env.GOOGLE_VERIFICATION_EMAIL) {
      return ctx.json(
        { message: "History synced successfully", count: 0 },
        200,
      );
    }

    if (!user?.is_gmail) {
      if (user?.outlook_id) {
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
        {
          error:
            "Failed to sync history for outlook, unable to find outlook id for user",
        },
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

    const tier = await getUserTier(userId);
    if (tier === "FREE") {
      return ctx.json({ error: "Upgrade to Pro to access storage analysis" }, 402);
    }

    const query = filteredQuerySchema.safeParse(ctx.req.query());
    if (!query.success) {
      return ctx.json({ error: z.treeifyError(query.error) }, 400);
    }

    const userData = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: {
        is_gmail: true,
      },
    });

    if (!userData) {
      return ctx.json({ error: "Error getting filtered mails" }, 500);
    }

    if (userData.is_gmail === true) {
      const { data: emails, nextPageToken } = await getFilteredMails(
        userId,
        query.data,
      );
      return ctx.json({ emails, nextPageToken }, 200);
    } else {
      const { data: emails, nextPageToken } = await getFilteredMailsOutlook(
        userId,
        query.data,
      );
      return ctx.json({ emails, nextPageToken }, 200);
    }
  })

  .get("/sent", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const tier = await getUserTier(userId);
    if (tier === "FREE") {
      return ctx.json({ error: "Upgrade to Pro to access follow-ups" }, 402);
    }

    const maxResults = ctx.req.query("maxResults")
      ? parseInt(ctx.req.query("maxResults")!)
      : undefined;
    const pageToken = ctx.req.query("pageToken") || undefined;
    const olderThan = ctx.req.query("olderThan")
      ? parseInt(ctx.req.query("olderThan")!)
      : undefined;

    const userData = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true, email: true },
    });

    if (!userData) {
      return ctx.json({ error: "User not found" }, 500);
    }

    if (userData.is_gmail) {
      const result = await getSentEmails(userId, { maxResults, pageToken, olderThan, userEmail: userData.email });
      return ctx.json({ ...result, is_gmail: true }, 200);
    }


    const result = await getSentEmailsOutlook(userId, {
      maxResults,
      skip: pageToken ? parseInt(pageToken) : undefined,
      olderThan,
      userEmail: userData.email,
    });
    return ctx.json({ ...result, is_gmail: false }, 200);
  })

  .post(
    "/deleteMessage",
    zValidator(
      "json",
      z.object({
        messageId: z.string(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to use this feature" }, 403);
      }

      const values = ctx.req.valid("json");

      const userData = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: {
          is_gmail: true,
        },
      });

      if (!userData) {
        return ctx.json({ error: "Error getting filtered mails" }, 500);
      }

      if (userData.is_gmail === true) {
        const response = await trashMessages(userId, [values.messageId]);

        if (response.error) {
          return ctx.json({ error: "Error deleting this message" }, 500);
        }

        return ctx.json({ response }, 200);
      } else {
        const response = await deleteOutlookMessage(userId, values.messageId);

        if (response.success===false) {
          return ctx.json({ error: "Error deleting this message" }, 500);
        }

        return ctx.json({ response }, 200);
      }
    },
  )
  .post(
    "/reply",
    zValidator(
      "json",
      z.object({
        id: z.string(),
        message: z.string().min(10).max(1000),
        to: z.string().optional(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();

      if (!userId) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to reply from the dashboard" }, 403);
      }

      const { id, message, to } = ctx.req.valid("json");

      const userData = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if (!userData) {
        return ctx.json({ error: "User not found" }, 500);
      }

      const extractEmail = (input: string) => {
        const match = input.match(/<([^>]+)>/);
        return match ? match[1].trim() : input.trim();
      };

      const cleanTo = to ? extractEmail(to) : undefined;

      try {
        if (userData.is_gmail) {
          const result = await replyToGmailThread(userId, id, message, cleanTo);
          await db.email_tracked.updateMany({
            where:{message_id:id},
            data:{
              isDone:true
            }
          })
          return ctx.json(result, 200);
        }

        const result = await replyToOutlookConversation(
          userId,
          id,
          message,
          cleanTo ? [cleanTo] : undefined,
        );
        await db.email_tracked.updateMany({
            where:{message_id:id},
            data:{
              isDone:true
            }
          })
        return ctx.json(result, 200);
      } catch (error) {
        console.error("Failed to send reply:", error);
        return ctx.json({ error: "Failed to send reply" }, 500);
      }
    },
  )

  .get("/thread/:threadId/last-message", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const threadId = ctx.req.param("threadId");
    if (!threadId) {
      return ctx.json({ error: "Thread ID is required" }, 400);
    }

    const userData = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true, email: true },
    });

    if (!userData) {
      return ctx.json({ error: "User not found" }, 500);
    }

    if (!userData.email) {
      return ctx.json({ error: "User email not found" }, 500);
    }

    try {
      if (userData.is_gmail) {
        const result = await getLastSentMessageInThreadGmail(userId, threadId, userData.email);
        return ctx.json({ ...result, is_gmail: true }, 200);
      }

      const result = await getLastSentMessageInThreadOutlook(userId, threadId, userData.email);
      return ctx.json({ ...result, is_gmail: false }, 200);
    } catch (error) {
      console.error("Failed to get last message:", error);
      return ctx.json({ error: "Failed to get last message" }, 500);
    }
  })

  .get("/body/:messageId", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const messageId = ctx.req.param("messageId");
    if (!messageId) {
      return ctx.json({ error: "Message ID is required" }, 400);
    }

    const userData = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true },
    });

    if (!userData) {
      return ctx.json({ error: "User not found" }, 500);
    }

    try {
      if (userData.is_gmail) {
        const body = await getGmailMessageBody(userId, messageId);
        return ctx.json({ body }, 200);
      }

      const body = await getOutlookMessageBody(userId, messageId);
      return ctx.json({ body }, 200);
    } catch (error) {
      if (error instanceof Error && error.message.includes("deleted or moved")) {
        return ctx.json({ error: error.message }, 200);
      }
      console.error("Failed to get message body:", error);
      return ctx.json({ error: "Failed to get message body" }, 500);
    }
  });

export default app;
