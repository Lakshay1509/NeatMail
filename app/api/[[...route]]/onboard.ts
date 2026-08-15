import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { isMemberAccessPaused } from "@/lib/organization";
import { getUserSubscribed } from "@/lib/supabase";
import { getPostHogClient } from "@/lib/posthog-server";
import { ensureResolvedTag } from "@/lib/tags";
import { ARCHIVE_DEFAULTS } from "@/lib/archive-defaults";
import {
  activationJobId,
  engagementScanQueue,
  mailboxActivationQueue,
  onboardScanJobId,
} from "@/lib/queue";
import { ENGAGEMENT_CONFIG } from "@/lib/engagement";
import type { Job } from "bullmq";

// completed/failed excluded on purpose: rules are committed before the job completes, so the caller can safely fall through to the DB.
async function isJobInProgress(job: Job): Promise<boolean> {
  const state = await job.getState();
  return (
    state === "waiting" ||
    state === "active" ||
    state === "delayed" ||
    state === "prioritized" ||
    state === "waiting-children"
  );
}

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
      // Only /onboard-complete (post-checkout) sets this; turns a missing subscription into a retryable 402 instead of a silent no-op.
      expectActivation: z.boolean().optional(),
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
      // Only mailbox activation is billing-gated, not preference saving — gating prefs too would strand paywall-decliners in the /onboarding redirect loop (app/page.tsx bounces any user with no user_tags row).
      // getUserSubscribed resolves an invited member to their org admin's coverage.
      const coverage = await getUserSubscribed(userId);

      // coverage.subscribed is true for paused members too (inherited tier), so this guard stops a paused member from re-arming their own watch via re-onboarding; same guard as activate-watch.ts.
      const accessPaused = await isMemberAccessPaused(userId);

      // Requires expectActivation, not just subscribed — otherwise an already-covered user's pre-paywall step-2 save would trigger the full backfill inline and risk a proxy timeout.
      if (body.expectActivation && coverage.subscribed && !accessPaused) {
        // Queued, not awaited: inline execution could outlast the proxy timeout, and useOnboard only retries SUBSCRIPTION_PENDING, so a timeout showed as a hard failure.
        // Dedupe is the shared jobId (activationJobId), not a DB read — email_tracked rows only land after the full backfill, so during the webhook/here race both callers would read zero and double-run.
        try {
          await mailboxActivationQueue.add(
            "activate",
            { userId },
            { jobId: activationJobId(userId) },
          );
        } catch (err) {
          // Non-fatal: webhook re-enqueues later; GET /reveal finds no job and falls through to the DB.
          console.error(
            "Failed to enqueue mailbox activation (non-fatal):",
            err,
          );
        }
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

        // Promise tracking ("they owe me") defaults ON for new users. Set only
        // on create so a re-onboard never flips a choice the user made later.
        await tx.follow_up_preference.upsert({
          where: { user_id: userId },
          update: {},
          create: {
            user_id: userId,
            track_promises: true,
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

      // Placed after the transaction: preferences commit first, so this 402 never costs the user their saved setup.
      // expectActivation drives this (not a server-side check) because paymentProcessing is derived from a webhook-written row that's false during exactly this race window; use-onboard.ts retries ~30s and every write above is idempotent.
      if (body.expectActivation && !coverage.subscribed) {
        return ctx.json(
          {
            error: "We're finalizing your subscription. This will only take a moment.",
            code: "SUBSCRIPTION_PENDING",
          },
          402,
          // Distinguishes this from plan-refusal 402s (lib/hono opens an upsell on those); sent as a header, not the body, since the client wrapper must not consume the response stream.
          { "X-Billing-Pending": "1" },
        );
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
          activated: coverage.subscribed,
        },
      });
      await posthog.shutdown();

      // activated tells /onboard-complete whether to play the scan reveal (true) or go straight to the gated dashboard (false).
      return ctx.json({ success: true, activated: coverage.subscribed }, 200);
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
).get(
  // Reports the outcome of the onboarding scan enqueued in POST / above
  // (jobId `onboard-scan:${userId}`), for the /onboard-complete reveal.
  // Domains are encrypted, so we only ever surface counts, not identities.
  "/reveal",
  async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      // Must check this before the scan job: activateMailbox enqueues the scan last (after backfill), so during the 10-20s ingestion window there's no scan job yet — checking only that would fall through to the DB and report "done" with zero rules, which /onboard-complete renders as "already tidy" prematurely.
      const activation = await mailboxActivationQueue.getJob(
        activationJobId(userId),
      );
      if (activation && (await isJobInProgress(activation))) {
        return ctx.json({ status: "pending" as const });
      }

      // Job is only a "still running?" signal; once it's gone or terminal we
      // trust the DB, since rules are committed before the job completes.
      const job = await engagementScanQueue.getJob(onboardScanJobId(userId));
      if (job && (await isJobInProgress(job))) {
        return ctx.json({ status: "pending" as const });
      }

      // AUTO rules written in the last 15 min == this scan's output.
      const windowStart = new Date(Date.now() - 15 * 60_000);
      const rules = await db.archiveRule.findMany({
        where: {
          user_id: userId,
          source: "AUTO",
          isActive: true,
          createdAt: { gte: windowStart },
          domain: { not: null },
        },
        select: { domain: true },
      });

      const domains = rules
        .map((r) => r.domain)
        .filter((d): d is string => d !== null);
      const sendersMuted = domains.length;

      let emailsSilenced = 0;
      if (sendersMuted > 0) {
        const trackWindow = new Date(
          Date.now() - ENGAGEMENT_CONFIG.windowDays * 86_400_000,
        );
        emailsSilenced = await db.email_tracked.count({
          where: {
            user_id: userId,
            domain: { in: domains },
            created_at: { gte: trackWindow },
          },
        });
      }

      return ctx.json({
        status: "done" as const,
        sendersMuted,
        emailsSilenced,
      });
    } catch (error) {
      // Degrade to an empty "done" so a failure here doesn't trap the reveal screen.
      console.error("Onboard reveal error (non-fatal):", error);
      return ctx.json({
        status: "done" as const,
        sendersMuted: 0,
        emailsSilenced: 0,
      });
    }
  },
);

export default app;
