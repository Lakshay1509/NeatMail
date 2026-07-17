import { Hono } from "hono";

import { db } from "@/lib/prisma";
import { deleteUser as deleteDraftUser } from "@/lib/draft";
import { deleteUser as deleteModelUser } from "@/lib/model";
import { clerkClient } from "@clerk/nextjs/server";
import { activateWatch } from "@/lib/gmail";
import { handleWatchDeactivation } from "@/lib/payement";
import { getOrganizationMemberIds } from "@/lib/organization";
import {
  updateHistoryId,
  updateOutlookId,
  getUserSubscribed,
  activeFolder,
} from "@/lib/supabase";
import { createOutlookSubscription } from "@/lib/outlook";
import { getUserTier } from "@/lib/tier-guard";
import { sweepArchiveRule } from "@/lib/archive-rules";
import { Resend } from "resend";

import DailyDigestEmail from "@/components/Email/DailyDigestEmail";
import {
  getDigestForUser,
  getDigestCount,
  trimDigestForEmail,
  getFollowUpsForUser,
} from "@/lib/digest";
import { formatInTimeZone } from "date-fns-tz";
import { render } from "@react-email/render";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

const app = new Hono()
  .get("/delete-user", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const clerk = clerkClient();

      const usersToDelete = await db.user_tokens.findMany({
        where: {
          deleted_flag: true,
          delete_at: {
            lte: new Date(),
          },
        },
      });

      const results = {
        total: usersToDelete.length,
        successful: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const user of usersToDelete) {
        try {
          // Downgrade + stop watching org members before the cascade delete wipes the org,
          // or they're left as stale ghosts (MAX tier, watched, unpaid). They get a fresh solo org on next onboarding.
          const memberIds = await getOrganizationMemberIds(user.clerk_user_id);
          if (memberIds.length > 0) {
            for (const memberId of memberIds) {
              await handleWatchDeactivation(memberId); // self-isolating, never throws
            }
            await db.user_tokens.updateMany({
              where: { clerk_user_id: { in: memberIds } },
              // Latch trial_used, same as other detach paths (leave, member removal).
              // These members already had MAX access as teammates, so don't let them start a second trial.
              data: { tier: "FREE", trial_used: true },
            });
          }

          await (await clerk).users.deleteUser(user.clerk_user_id);

          await db.user_tokens.delete({
            where: {
              clerk_user_id: user.clerk_user_id,
            },
          });

          try {
            const draftResult = await deleteDraftUser(user.clerk_user_id);
            console.log(
              `Deleted ${draftResult.vectors_deleted} vectors from draft model for user: ${user.clerk_user_id}`,
            );
          } catch (draftError) {
            console.error(
              `Failed to delete draft model data for user ${user.clerk_user_id}:`,
              draftError,
            );
          }

          try {
            const modelResult = await deleteModelUser(user.clerk_user_id);
            console.log(
              `Deleted classification data for user ${user.clerk_user_id}: ${modelResult.status}`,
            );
          } catch (modelError) {
            console.error(
              `Failed to delete classification model data for user ${user.clerk_user_id}:`,
              modelError,
            );
          }

          results.successful++;
          console.log(`Successfully deleted user: ${user.clerk_user_id}`);
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to delete user ${user.clerk_user_id}: ${errorMessage}`,
          );
          console.error(`Failed to delete user ${user.clerk_user_id}:`, error);
        }
      }

      return ctx.json({
        message: "User deletion completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/renew-watch", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    try {
      const [activeSubscriptions, activeTrials] = await Promise.all([
        db.subscription.findMany({
          where: {
            status: "active",
            user_tokens: { deleted_flag: false },
          },
          select: {
            dodoSubscriptionId: true,
            customerEmail: true,
            user_tokens: {
              select: {
                clerk_user_id: true,
                is_gmail: true,
              },
            },
          },
        }),
        db.free_trial.findMany({
          where: {
            status: "ACTIVE",
            expires_at: { gt: new Date() },
            user_tokens: { deleted_flag: false },
          },
          select: {
            user_id: true,
            email: true,
            user_tokens: {
              select: {
                clerk_user_id: true,
                is_gmail: true,
              },
            },
          },
        }),
      ]);

      // Members have no subscription/free_trial row of their own, so the loops below skip them
      // and their watch would lapse. Renew active (non-paused) members of covered owners too.
      const coveredOwnerIds = Array.from(
        new Set([
          ...activeSubscriptions.map((s) => s.user_tokens.clerk_user_id),
          ...activeTrials.map((t) => t.user_tokens.clerk_user_id),
        ]),
      );
      const teamMembers = coveredOwnerIds.length
        ? await db.organizationMember.findMany({
            where: {
              active: true,
              role: "MEMBER",
              organization: { created_by: { in: coveredOwnerIds } },
              user_tokens: { deleted_flag: false },
            },
            select: {
              user_tokens: {
                select: { clerk_user_id: true, is_gmail: true, email: true },
              },
            },
          })
        : [];

      const results = {
        total:
          activeSubscriptions.length + activeTrials.length + teamMembers.length,
        subscribed: 0,
        trials: 0,
        members: 0,
        free: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const sub of activeSubscriptions) {
        try {
          if (sub.user_tokens.is_gmail === true) {
            const response = await activateWatch(sub.user_tokens.clerk_user_id);

            await updateHistoryId(sub.customerEmail, response.history_id, true);

            results.subscribed++;
            console.log(`✅ Watch renewed for: ${sub.customerEmail}`);
          } else {
            const activeFolderData = await activeFolder(sub.user_tokens.clerk_user_id);
            const foldersData = activeFolderData
              .filter((folder) => folder.isActive === true)
              .map((folder) => ({
                id: folder.id,
                name: folder.name,
              }));

            const response = await createOutlookSubscription(
              sub.user_tokens.clerk_user_id,
              foldersData,
            );
            await updateOutlookId(sub.customerEmail, response?.map(r => r.id).join(",") || null, true);

            results.subscribed++;
            console.log(`✅ Watch renewed outlook for: ${sub.customerEmail}`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to renew watch for ${sub.customerEmail}: ${errorMessage}`,
          );
          console.error(
            `❌ Watch renewal failed for ${sub.customerEmail}:`,
            error,
          );
        }
      }

      for (const sub of activeTrials) {
        try {
          if (sub.user_tokens.is_gmail === true) {
            const response = await activateWatch(sub.user_tokens.clerk_user_id);

            await updateHistoryId(sub.email, response.history_id, true);

            results.trials++;
            console.log(`✅ Watch renewed for: ${sub.email}`);
          } else {
            const activeFolderData = await activeFolder(sub.user_id);

            const foldersData = activeFolderData
              .filter((folder) => folder.isActive === true)
              .map((folder) => ({
                id: folder.id,
                name: folder.name,
              }));

            const response = await createOutlookSubscription(
              sub.user_tokens.clerk_user_id,
              foldersData,
            );
            await updateOutlookId(sub.email, response?.map(r => r.id).join(",") || null, true);

            results.trials++;
            console.log(`✅ Watch renewed outlook for: ${sub.email}`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to renew watch for ${sub.email}: ${errorMessage}`,
          );
          console.error(`❌ Watch renewal failed for ${sub.email}:`, error);
        }
      }

      // Inherited team members (owners are handled by the two loops above).
      for (const member of teamMembers) {
        const uid = member.user_tokens.clerk_user_id;
        const memberEmail = member.user_tokens.email ?? undefined;
        try {
          if (member.user_tokens.is_gmail === true) {
            const response = await activateWatch(uid);
            await updateHistoryId(memberEmail, response.history_id, true);
            results.members++;
            console.log(`✅ Watch renewed for member: ${memberEmail}`);
          } else {
            const activeFolderData = await activeFolder(uid);
            const foldersData = activeFolderData
              .filter((folder) => folder.isActive === true)
              .map((folder) => ({ id: folder.id, name: folder.name }));

            const response = await createOutlookSubscription(uid, foldersData);
            await updateOutlookId(
              memberEmail,
              response?.map((r) => r.id).join(",") || null,
              true,
            );
            results.members++;
            console.log(`✅ Watch renewed outlook for member: ${memberEmail}`);
          }
        } catch (error) {
          results.failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to renew watch for member ${memberEmail}: ${errorMessage}`,
          );
          console.error(
            `❌ Watch renewal failed for member ${memberEmail}:`,
            error,
          );
        }
      }

      // Free tier users don't get watch renewed, they're deactivated instead.

      return ctx.json({
        message: "Watch renewal completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Watch renewal cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/mail/send-reminder", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
      const subscriptions = await db.subscription.findMany({
        where: {
          status: "active",
          nextBillingDate: {
            gte: now,
            lt: in24Hours,
          },
          cancelAtNextBillingDate: true,
          reminder_sent_at: null,
          user_tokens: { deleted_flag: false },
        },
      });

      for (const sub of subscriptions) {
        try {
          const startOfPeriod = new Date(now);
          startOfPeriod.setDate(startOfPeriod.getDate() - 30);

          const endOfPeriod = new Date(now);

          const data = await db.email_tracked.count({
            where: {
              user_id: sub.clerkUserId,
              created_at: {
                gte: startOfPeriod,
                lt: endOfPeriod,
              },
            },
          });

          const client = await clerkClient();
          const clerkUser = await client.users.getUser(sub.clerkUserId);

          await resend.emails.send({
            to: sub.customerEmail,
            template: {
              id: "subscription-renewal-reminder",
              variables: {
                firstName: clerkUser.fullName ?? "User",
                last30DaysCount: String(data),
                renewalLink: "https://dashboard.neatmail.app/billing",
              },
            },
          });

          await db.subscription.update({
            where: { id: sub.id },
            data: { reminder_sent_at: new Date() },
          });
        } catch (error) {
          console.error(
            `Failed to send subscription reminder to ${sub.customerEmail}:`,
            error,
          );
        }
      }

      const freeTrial = await db.free_trial.findMany({
        where: {
          status: "ACTIVE",
          expires_at: {
            gte: now,
            lt: in24Hours,
          },
          reminder_sent_at: null,
          user_tokens: { deleted_flag: false },
        },
        select: {
          user_id: true,
          user_tokens: {
            select: {
              email: true,
            },
          },
        },
      });

      for (const sub of freeTrial) {
        try {
          const startOfPeriod = new Date(now);
          startOfPeriod.setDate(startOfPeriod.getDate() - 30);

          const endOfPeriod = new Date(now);

          const data = await db.email_tracked.count({
            where: {
              user_id: sub.user_id,
              created_at: {
                gte: startOfPeriod,
                lt: endOfPeriod,
              },
            },
          });

          const client = await clerkClient();
          const clerkUser = await client.users.getUser(sub.user_id);

          await resend.emails.send({
            to: sub.user_tokens.email,
            template: {
              id: "free-trial-renewal-reminder",
              variables: {
                firstName: clerkUser.fullName ?? "User",
                last30DaysCount: String(data),
                renewalLink: "https://dashboard.neatmail.app/billing",
              },
            },
          });

          await db.free_trial.update({
            where: { user_id: sub.user_id },
            data: { reminder_sent_at: new Date() },
          });
        } catch (error) {
          console.error(
            `Failed to send free trial  reminder to ${sub.user_tokens.email}:`,
            error,
          );
        }
      }

      return ctx.json({
        message: "Reminder check completed",
        timestamp: now.toISOString(),
        total: subscriptions.length + freeTrial.length,
      });
    } catch (error) {
      console.error("Send reminder cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  })
  .get("/deactivate-trials", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date();
    const results = {
      trialsExpired: 0,
      trialsDeactivated: 0,
      tierDowngraded: 0,
      freeDeactivated: 0,
      errors: [] as string[],
    };

    try {
      const [expiredTrials] = await db.$transaction(async (tx) => {
        const trials = await tx.free_trial.findMany({
          where: {
            status: "ACTIVE",
            expires_at: { lte: new Date() },
          },
          select: {
            user_id: true,
            user_tokens: {
              select: { email: true },
            },
          },
        });

        const count = await tx.free_trial.updateMany({
          where: {
            status: "ACTIVE",
            expires_at: { lte: new Date() },
          },
          data: { status: "EXPIRED" },
        });

        return [trials, count];
      });

      results.trialsExpired = expiredTrials.length;

      for (const trial of expiredTrials) {
        try {
          const hasActiveSub = await db.subscription.findFirst({
            where: { clerkUserId: trial.user_id, status: "active" },
          });

          if (!hasActiveSub) {
            // Downgrade to FREE: an active trial keeps tier at MAX (lib/payement.ts), so this must run.
            // Runs first since the trial is already marked EXPIRED and won't be re-selected next run.
            await db.user_tokens.update({
              where: { clerk_user_id: trial.user_id },
              data: { tier: "FREE" },
            });
            results.tierDowngraded++;

            await handleWatchDeactivation(trial.user_id);
            results.trialsDeactivated++;

            const client = await clerkClient();
            const clerkUser = await client.users.getUser(trial.user_id);

            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfNextMonth = new Date(
              now.getFullYear(),
              now.getMonth() + 1,
              1,
            );

            const data = await db.email_tracked.count({
              where: {
                user_id: trial.user_id,
                created_at: {
                  gte: startOfMonth,
                  lt: startOfNextMonth,
                },
              },
            });

            await resend.emails.send({
              to: trial.user_tokens.email,
              template: {
                id: "free-trial-ended",
                variables: {
                  firstName: clerkUser.fullName ?? "User",
                  last30DaysCount: String(data),
                  renewalLink: "https://dashboard.neatmail.app/billing",
                },
              },
            });
          }
        } catch (error) {
          results.errors.push(
            `Failed to deactivate trial for ${trial.user_id}: ${error}`,
          );
          console.error(
            `Failed to deactivate trial for ${trial.user_tokens.email}:`,
            error,
          );
        }
      }

      const freeUsers = await db.user_tokens.findMany({
        where: {
          tier: "FREE",
          watch_activated: true,
          deleted_flag: false,
          OR: [
            { free_trial: null },
            { free_trial: { status: { not: "ACTIVE" } } },
          ],
          subscriptions: { none: { status: "active" } },
        },
        select: {
          clerk_user_id: true,
          email: true,
        },
      });

      for (const user of freeUsers) {
        try {
          await handleWatchDeactivation(user.clerk_user_id);
          results.freeDeactivated++;
          console.log(`Deactivated watch for free user: ${user.email}`);
        } catch (error) {
          results.errors.push(
            `Failed to deactivate free user ${user.clerk_user_id}: ${error}`,
          );
          console.error(
            `Failed to deactivate watch for free user ${user.email}:`,
            error,
          );
        }
      }

      return ctx.json({
        message: "Deactivation completed",
        timestamp: new Date().toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Deactivate cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
          ...results,
        },
        500,
      );
    }
  })


  .post("/archive-messages", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();
    const results = {
      totalRules: 0,
      totalMessages: 0,
      archivedGmail: 0,
      archivedOutlook: 0,
      failed: 0,
      errors: [] as string[],
    };

    try {
      const activeRules = await db.archiveRule.findMany({
        where: {
          isActive: true,
          // Same deleted_flag guard as the other cron routes below.
          user_tokens: { deleted_flag: false },
        },
        select: {
          id: true,
          user_id: true,
          domain: true,
          tag_id: true,
          archiveAfterDays: true,
          source: true,
          createdAt: true,
        },
      });

      results.totalRules = activeRules.length;

      for (const rule of activeRules) {
        try {
          // Skip users on FREE tier. Org-aware: a member inherits their admin's
          // tier, so resolve it rather than reading the member's own row.
          const tier = await getUserTier(rule.user_id);
          if (tier === "FREE") {
            continue;
          }

          const subStatus = await getUserSubscribed(rule.user_id);
          if (!subStatus.subscribed) {
            continue;
          }

          // Shared with the immediate-sweep worker so both stay in sync.
          const swept = await sweepArchiveRule(rule, now);
          results.totalMessages += swept.matched;
          results.archivedGmail += swept.archivedGmail;
          results.archivedOutlook += swept.archivedOutlook;
          results.failed += swept.failed;
          results.errors.push(...swept.errors);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to process rule for ${rule.tag_id ? `tag ${rule.tag_id}` : `domain ${rule.domain}`}: ${errorMessage}`,
          );
          console.error(
            `Failed to process archive rule (${rule.tag_id ? `tag ${rule.tag_id}` : `domain ${rule.domain}`}):`,
            error,
          );
        }
      }

      return ctx.json({
        message: "Archive job completed",
        timestamp: now.toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Archive cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
          ...results,
        },
        500,
      );
    }
  })
  .post(
    "/sendNewMails",
    zValidator(
      "json",
      z.object({
        mails: z.array(z.string()).min(1).max(30),
      }),
    ),
    async (ctx) => {
      const authHeader = ctx.req.header("x-authorization");
      const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

      if (authHeader !== expectedToken) {
        return ctx.json({ error: "Unauthorized" }, 401);
      }

      try {
        const values = ctx.req.valid("json");

        const resend = new Resend(process.env.RESEND_API_KEY);
        let successCount = 0;
        const failedMails = [];

        for (const mail of values.mails) {
          try {
            
            const { data: resData, error: resError } = await resend.emails.send(
              {
                from: "Lakshay <lakshay@send.neatmail.app>",
                to: mail,
                subject: "Your inbox just met its match",
                text: `Hey,

You signed up for NeatMail — here's why people are excited about it:

NeatMail reads every email that lands in your Gmail/Outlook inbox and uses AI to:
→ Auto-label everything (Action Needed, Waiting, etc.) — labels sync back to Gmail
→ Generate draft replies in your tone with context from your calendar + Slack
→ One-click unsubscribe, auto-archive rules, follow-up reminders
→ Telegram integration so you can triage without opening your inbox

And yes — it actually works with Google's verification now. Clean sign-in, no warnings.

Your access is ready: https://dashboard.neatmail.app/

Also — as an early user, I'm locking in your current plan at a rate I can't offer again.

— Lakshay`,
              },
            );

            if (resError) {
              console.error("Resend API error for", mail, resError);
              failedMails.push(mail);
            } else {
              successCount++;
            }

            // Throttle to stay under Resend rate limits.
            await new Promise((resolve) => setTimeout(resolve, 600));
          } catch (error) {
            console.error("Error sending new mail to", mail, error);
            failedMails.push(mail);
          }
        }

        return ctx.json({
          success: true,
          count: successCount,
          failed: failedMails,
        });
      } catch (error) {
        console.error("Error sending new mails to the users:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return ctx.json(
          {
            error: "Internal server error",
            details: errorMessage,
          },
          500,
        );
      }
    },
  )
  .get("/send-daily-digest", async (ctx) => {
    const authHeader = ctx.req.header("x-authorization");
    const expectedToken = `Bearer ${process.env.CRON_SECRET}`;

    if (authHeader !== expectedToken) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const now = new Date();
    const results = {
      totalChecked: 0,
      sent: 0,
      skipped: 0,
      errors: [] as string[],
    };

    try {
      const preferences = await db.digest_preference.findMany({
        where: {
          enabled: true,
          user_tokens: { deleted_flag: false },
        },
        include: {
          user_tokens: {
            select: { email: true, clerk_user_id: true, tier: true, is_gmail: true },
          },
        },
      });

      results.totalChecked = preferences.length;

      for (const pref of preferences) {
        try {
          const lastSent = pref.last_sent_at;
          if (lastSent) {
            const lastSentDate = new Date(lastSent);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (lastSentDate >= today) {
              results.skipped++;
              continue;
            }
          }

          // Check if current time in user's timezone matches delivery_time (±15 min)
          const userLocalTime = formatInTimeZone(now, pref.timezone, "HH:mm");
          const [prefHour, prefMin] = pref.delivery_time.split(":").map(Number);
          const [userHour, userMin] = userLocalTime.split(":").map(Number);
          const prefMinutes = prefHour * 60 + prefMin;
          const userMinutes = userHour * 60 + userMin;
          const diff = Math.abs(userMinutes - prefMinutes);

          if (diff > 15) {
            results.skipped++;
            continue;
          }

          const userEmail = pref.user_tokens.email;
          const userId = pref.user_tokens.clerk_user_id;

          // Only send digest to users with active subscription or active free trial
          const subStatus = await getUserSubscribed(userId);
          if (!subStatus.subscribed) {
            results.skipped++;
            continue;
          }

          const count = await getDigestCount(userId);
          const followUps = await getFollowUpsForUser(userId, 5);

          if (count === 0 && followUps.total === 0) {
            await resend.emails.send({
              from: "NeatMail <digest@send.neatmail.app>",
              to: userEmail,
              subject: "You're all caught up 🎉",
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
                <h2 style="font-size:20px;color:#111;margin:0 0 16px;">Good morning — your inbox is clear.</h2>
                <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
                  No flagged emails from the last 24 hours. NeatMail kept everything organized while you were away.
                </p>
                <a href="https://dashboard.neatmail.app" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Open Dashboard</a>
                <p style="font-size:12px;color:#888;margin-top:24px;">Your daily digest from NeatMail</p>
              </div>`,
            });
          } else {
            const digest = count > 0 ? await getDigestForUser(userId) : [];
            const trimmed = trimDigestForEmail(digest, 10);
            const shownCount = trimmed.groups.reduce((sum, g) => sum + g.emails.length, 0);
            const shownFollowUps = followUps.items.length;
            const followUpRemaining = followUps.total - shownFollowUps;
            const dateLabel = formatInTimeZone(now, pref.timezone, "EEEE, MMMM d");

            const emailHtml = await render(
              DailyDigestEmail({
                totalEmails: shownCount,
                dateLabel,
                isGmail: pref.user_tokens.is_gmail,
                remainingCount: trimmed.remainingCount,
                groups: trimmed.groups.map((g) => ({
                  urgency: g.urgency,
                  label: g.label,
                  emails: g.emails.map((e) => ({
                    message_id: e.message_id,
                    ai_summary: e.ai_summary,
                    ai_action: e.ai_action,
                    from: e.from,
                    ageText: getAgeText(e.created_at),
                  })),
                })),
                followUps: followUps.items.map((f) => ({
                  message_id: f.message_id,
                  to: f.to,
                  ageText: getAgeText(f.created_at),
                })),
                followUpRemaining,
              })
            );

            const subject =
              shownCount > 0
                ? `NeatMail digest: ${shownCount} email${shownCount > 1 ? "s" : ""}`
                : `NeatMail digest: ${shownFollowUps} follow-up${shownFollowUps > 1 ? "s" : ""} ready`;

            await resend.emails.send({
              from: "NeatMail <digest@send.neatmail.app>",
              to: userEmail,
              subject,
              html: emailHtml,
            });
          }

          await db.digest_preference.update({
            where: { id: pref.id },
            data: { last_sent_at: now },
          });

          results.sent++;

          // Throttle: 2s between users to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to send digest to ${pref.user_tokens.email}: ${errorMessage}`,
          );
          console.error(
            `Failed to send digest to ${pref.user_tokens.email}:`
            , error,
          );
        }
      }

      return ctx.json({
        message: "Daily digest check completed",
        timestamp: now.toISOString(),
        ...results,
      });
    } catch (error) {
      console.error("Daily digest cron job error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return ctx.json(
        {
          error: "Internal server error",
          details: errorMessage,
        },
        500,
      );
    }
  });

function getAgeText(createdAt: Date): string {
  const hours = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60),
  );
  if (hours < 1) return "Just now";
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export default app;
