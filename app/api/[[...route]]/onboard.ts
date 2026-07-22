import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { handleWatchActivation } from "@/lib/payement";
import { getPreviousMails } from "@/lib/gmail";
import { getPreviousOutlookMails } from "@/lib/outlook";
import { encryptDomain } from "@/lib/encode";
import { getUserIsGmail, getUserSubscribed } from "@/lib/supabase";
import { getPostHogClient } from "@/lib/posthog-server";
import { ensureResolvedTag } from "@/lib/tags";
import { ARCHIVE_DEFAULTS } from "@/lib/archive-defaults";
import { engagementScanQueue } from "@/lib/queue";

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
      // Only complete once billing is live. getUserSubscribed resolves an
      // invited member to their org admin's coverage; client retries until the webhook lands.
      const coverage = await getUserSubscribed(userId);

      if (!coverage.subscribed) {
        return ctx.json(
          {
            error: "We're finalizing your subscription. This will only take a moment.",
            code: "SUBSCRIPTION_PENDING",
          },
          402,
        );
      }

      const isGmailData = await getUserIsGmail(userId);

      // Re-check watch activation in case the subscription webhook hasn't run yet.
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

      // Trial activation and tier assignment happen in the subscription
      // webhook (card-required checkout), not here.
      await db.$transaction(async (tx) => {
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

        await tx.user_tags.deleteMany({ where: { user_id: userId } });
        await tx.user_tags.createMany({
          data: tagRecords.map((tag) => ({
            user_id: userId,
            tag_id: tag.id,
          })),
          skipDuplicates: true,
        });

        // Seed default archive rules for whichever ARCHIVE_DEFAULTS categories
        // the user picked. SEEDED, so they're future-only and never touch the
        // history imported above. skipDuplicates keeps a re-run idempotent
        // without clobbering a rule the user already edited.
        const tagIdByName = new Map(tagRecords.map((t) => [t.name, t.id]));
        const seedRows = ARCHIVE_DEFAULTS.map((d) => {
          const tagId = tagIdByName.get(d.name);
          return tagId
            ? {
                user_id: userId,
                tag_id: tagId,
                archiveAfterDays: d.days,
                isActive: true,
                source: "SEEDED" as const,
              }
            : null;
        }).filter((r): r is NonNullable<typeof r> => r !== null);

        if (seedRows.length > 0) {
          await tx.archiveRule.createMany({
            data: seedRows,
            skipDuplicates: true,
          });
        }

        // Same contract as the tags route: dropping a category on re-onboarding
        // deactivates its archive rule too. No-op on first-time onboarding.
        await tx.archiveRule.updateMany({
          where: {
            user_id: userId,
            tag_id: { not: null, notIn: tagRecords.map((t) => t.id) },
            isActive: true,
          },
          data: { isActive: false },
        });

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

          // Follow-ups need the "Resolved" tag to close threads; ensure it exists even if unpicked.
          if (body.followUpPrefs.enabled) {
            await ensureResolvedTag(tx, userId);
          }
        }
      });

      // Dedicated engagement scan for this brand-new user. The history sync
      // above just backfilled email_tracked, so the scan has data to judge
      // noisy senders against right away instead of waiting up to 6h for the
      // periodic run. notify:true → the worker emails the auto-mute count when
      // it finds anything. jobId dedupes retries/re-onboards; enqueue failures
      // are non-fatal so a Redis hiccup can't fail an otherwise-complete onboard.
      try {
        await engagementScanQueue.add(
          "scan-user",
          { userId, notify: true },
          { jobId: `onboard-scan:${userId}` },
        );
      } catch (err) {
        console.error("Failed to enqueue onboarding engagement scan (non-fatal):", err);
      }

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
