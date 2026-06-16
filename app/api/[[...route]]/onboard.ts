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
      }),
      digestPrefs: z.object({
        enabled: z.boolean(),
        deliveryTime: z
          .string()
          .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/),
        timezone: z.string(),
      }),
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
      // Step 1: External API calls (idempotent, can't be in DB transaction)
      const [[existingTrial, existingSub, existingPayment], isGmailData] =
        await Promise.all([
          Promise.all([
            db.free_trial.findUnique({ where: { user_id: userId } }),
            db.subscription.findFirst({ where: { clerkUserId: userId } }),
            db.paymentHistory.findFirst({
              where: { clerkUserId: userId, amount: 0, status: "succeeded" },
            }),
          ]),
          getUserIsGmail(userId),
        ]);

      const hasTrialOrPaid = existingTrial || existingSub || existingPayment;

      if (!hasTrialOrPaid) {
        await handleWatchActivation(userId);
      } else {
        const { isGmail } = isGmailData;
        const token = await db.user_tokens.findUnique({
          where: { clerk_user_id: userId },
          select: { watch_activated: true },
        });
        if (!token?.watch_activated) {
          await handleWatchActivation(userId);
        }
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

      // Step 2: All DB writes in a single atomic transaction
      await db.$transaction(async (tx) => {
        // 2a. Free trial + tier (skip if already exists)
        if (!existingTrial) {
          await tx.free_trial.create({
            data: {
              user_id: userId,
              email,
              started_at: new Date(),
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              status: "ACTIVE",
            },
          });
        }

        if (!existingTrial && !existingSub && !existingPayment) {
          await tx.user_tokens.update({
            where: { clerk_user_id: userId },
            data: { tier: "MAX" },
          });
        }

        // 2b. Draft preferences (upsert)
        await tx.draft_preference.upsert({
          where: { user_id: userId },
          update: {
            enabled: body.draftPrefs.enabled,
            fontColor: body.draftPrefs.fontColor,
            fontSize: body.draftPrefs.fontSize,
            timezone: body.draftPrefs.timezone,
          },
          create: {
            user_id: userId,
            enabled: body.draftPrefs.enabled,
            fontColor: body.draftPrefs.fontColor,
            fontSize: body.draftPrefs.fontSize,
            timezone: body.draftPrefs.timezone,
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
      });

      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: "onboarding_completed",
        properties: {
          tagCount: body.tags.length,
          draftEnabled: body.draftPrefs.enabled,
          digestEnabled: body.digestPrefs.enabled,
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
