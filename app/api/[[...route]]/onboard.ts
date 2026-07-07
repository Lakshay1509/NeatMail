import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { handleWatchActivation } from "@/lib/payement";
import { getPreviousMails } from "@/lib/gmail";
import { getPreviousOutlookMails } from "@/lib/outlook";
import { encryptDomain } from "@/lib/encode";
import { getUserIsGmail } from "@/lib/supabase";
import { getPostHogClient } from "@/lib/posthog-server";
import { ensureResolvedTag } from "@/lib/tags";

const app = new Hono().post(
  "/",
  zValidator(
    "json",
    z.object({
      tags: z.array(z.string()).min(1).max(30),
      draftPrefs: z.object({
        enabled: z.boolean(),
        fontColor: z.string(),
        fontSize: z.number().min(8).max(72),
        timezone: z.string(),
        draftPrompt: z.string().optional(),
      }),
      digestPrefs: z.object({
        enabled: z.boolean(),
        deliveryTime: z
          .string()
          .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/),
        timezone: z.string(),
      }),
      followUpPrefs: z.object({
        enabled: z.boolean(),
        days: z.number().int().min(1).max(30),
        ai_drafts:z.boolean()
      }).optional(),
    }),
  ),
  async (ctx) => {
    const { userId } = await auth();
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;

    if (!userId || !email) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const body = ctx.req.valid("json");

    try {
      // Gate: only complete onboarding once the card-required checkout has
      // produced an active subscription (or an active free trial). The
      // subscription webhook performs activation/tier assignment; this handles
      // the brief window before it lands (the client retries on this code).
      const [activeSubscription, activeTrial] = await Promise.all([
        db.subscription.findFirst({
          where: { clerkUserId: userId, status: "active" },
        }),
        db.free_trial.findFirst({
          where: {
            user_id: userId,
            status: "ACTIVE",
            expires_at: { gt: new Date() },
          },
        }),
      ]);

      if (!activeSubscription && !activeTrial) {
        return ctx.json(
          {
            error: "We're finalizing your subscription. This will only take a moment.",
            code: "SUBSCRIPTION_PENDING",
          },
          402,
        );
      }

      const isGmailData = await getUserIsGmail(userId);

      // Ensure the inbox watch is active. The webhook normally activates it on
      // subscription activation; re-check here in case it hasn't run yet.
      const watchToken = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { watch_activated: true },
      });
      if (!watchToken?.watch_activated) {
        await handleWatchActivation(userId);
      }

      // Sync history (idempotent)
      try {
        const { isGmail } = isGmailData;
        if (isGmail) {
          const mails = await getPreviousMails(userId);
          if (mails && mails.length > 0) {
            const insertData = await Promise.all(
              mails.map(async (mail: any) => {
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
          }
        } else {
          const mails = await getPreviousOutlookMails(userId);
          if (mails && mails.length > 0) {
            const insertData = await Promise.all(
              mails.map(async (mail: any) => {
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
          }
        }
      } catch (err) {
        console.error("History sync error (non-fatal):", err);
      }

      // Step 2: All DB writes in a single atomic transaction.
      // Note: trial activation and tier assignment are handled by the
      // subscription webhook (card-required checkout), not here.
      await db.$transaction(async (tx) => {
        // 2b. Draft preferences (upsert)
        await tx.draft_preference.upsert({
          where: { user_id: userId },
          update: {
            enabled: body.draftPrefs.enabled,
            fontColor: body.draftPrefs.fontColor,
            fontSize: body.draftPrefs.fontSize,
            timezone: body.draftPrefs.timezone,
            ...(body.draftPrefs.draftPrompt !== undefined && {
              draftPrompt: body.draftPrefs.draftPrompt,
            }),
          },
          create: {
            user_id: userId,
            enabled: body.draftPrefs.enabled,
            fontColor: body.draftPrefs.fontColor,
            fontSize: body.draftPrefs.fontSize,
            timezone: body.draftPrefs.timezone,
            ...(body.draftPrefs.draftPrompt !== undefined && {
              draftPrompt: body.draftPrefs.draftPrompt,
            }),
          },
        });

        // 2c. Digest preferences (upsert)
        await tx.digest_preference.upsert({
          where: { user_id: userId },
          update: {
            enabled: body.digestPrefs.enabled,
            delivery_time: body.digestPrefs.deliveryTime,
            timezone: body.digestPrefs.timezone,
          },
          create: {
            user_id: userId,
            enabled: body.digestPrefs.enabled,
            delivery_time: body.digestPrefs.deliveryTime,
            timezone: body.digestPrefs.timezone,
          },
        });

        // 2d. Look up system + user tags
        const tagRecords = await tx.tag.findMany({
          where: {
            name: { in: body.tags },
            OR: [{ user_id: userId }, { user_id: null }],
          },
        });

        if (tagRecords.length === 0) {
          throw new Error(
            "No matching tags found. Ensure system tags exist in the tag table.",
          );
        }

        // 2e. Replace user tags
        await tx.user_tags.deleteMany({ where: { user_id: userId } });
        await tx.user_tags.createMany({
          data: tagRecords.map((tag) => ({
            user_id: userId,
            tag_id: tag.id,
          })),
          skipDuplicates: true,
        });

        // 2f. Follow-up preferences (upsert)
        if (body.followUpPrefs) {
          await tx.follow_up_preference.upsert({
            where: { user_id: userId },
            update: {
              enabled: body.followUpPrefs.enabled,
              days: body.followUpPrefs.days,
              ai_drafts:body.followUpPrefs.ai_drafts
            },
            create: {
              user_id: userId,
              enabled: body.followUpPrefs.enabled,
              days: body.followUpPrefs.days,
              ai_drafts:body.followUpPrefs.ai_drafts
            },
          });

          // Follow-ups depend on "Resolved" to close out tracked threads, so
          // guarantee the tag is present even if the user didn't pick it.
          if (body.followUpPrefs.enabled) {
            await ensureResolvedTag(tx, userId);
          }
        }
      });

      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: "onboarding_completed",
        properties: {
          tagCount: body.tags.length,
          draftEnabled: body.draftPrefs.enabled,
          digestEnabled: body.digestPrefs.enabled,
          followUpEnabled: body.followUpPrefs?.enabled ?? false,
        },
      });
      await posthog.shutdown();

      return ctx.json({ success: true }, 200);
    } catch (error) {
      console.error("Onboarding error:", error);
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId || "unknown",
        event: "onboarding_failed",
        properties: { error: error instanceof Error ? error.message : "Unknown error" },
      });
      await posthog.shutdown();
      return ctx.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Onboarding failed. Please try again.",
        },
        500,
      );
    }
  },
);

export default app;
