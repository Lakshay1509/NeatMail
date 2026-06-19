import { Hono } from "hono";

import { db } from "@/lib/prisma";
import { deleteUser as deleteDraftUser } from "@/lib/draft";
import { deleteUser as deleteModelUser } from "@/lib/model";
import { clerkClient } from "@clerk/nextjs/server";
import { activateWatch } from "@/lib/gmail";
import { handleWatchDeactivation } from "@/lib/payement";
import {
  updateHistoryId,
  updateOutlookId,
  getUserSubscribed,
  activeFolder,
} from "@/lib/supabase";
import { createOutlookSubscription } from "@/lib/outlook";
import { trashMessages as archiveGmailMessages } from "@/lib/gmail";
import { archiveMessagesOutlook } from "@/lib/outlook";
import { Resend } from "resend";

import DailyDigestEmail from "@/components/Email/DailyDigestEmail";
import { getDigestForUser, getDigestCount, trimDigestForEmail } from "@/lib/digest";
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

      const results = {
        total: activeSubscriptions.length + activeTrials.length,
        subscribed: 0,
        trials: 0,
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

      // Free tier users no longer get watch renewed — they are deactivated

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
      freeDeactivated: 0,
      errors: [] as string[],
    };

    try {
      // Step 1: Deactivate expired trials
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

      // Step 2: Deactivate free tier users with watch activated
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
      // Get all active archive rules
      const activeRules = await db.archiveRule.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          user_id: true,
          domain: true,
          archiveAfterDays: true,
          user_tokens: {
            select: { tier: true },
          },
        },
      });

      results.totalRules = activeRules.length;

      // Process each rule
      for (const rule of activeRules) {
        try {
          // Skip users on FREE tier
          if (rule.user_tokens.tier === "FREE") {
            continue;
          }

          // Skip users who are not subscribed
          const subStatus = await getUserSubscribed(rule.user_id);
          if (!subStatus.subscribed) {
            continue;
          }

          // Calculate the threshold date
          const thresholdDate = new Date(now);
          thresholdDate.setDate(
            thresholdDate.getDate() - rule.archiveAfterDays,
          );

          // Find messages that match this rule's domain and are older than the threshold
          // Also ensure they haven't been archived yet (archive_at is null)
          const messagesToArchive = await db.email_tracked.findMany({
            where: {
              user_id: rule.user_id,
              domain: rule.domain,
              created_at: {
                lt: thresholdDate,
              },
              archive_at: null,
            },
            select: {
              message_id: true,
              user_tokens: {
                select: {
                  is_gmail: true,
                  clerk_user_id: true,
                },
              },
            },
          });

          if (messagesToArchive.length === 0) {
            continue;
          }

          results.totalMessages += messagesToArchive.length;

          // Group messages by user and email type (Gmail vs Outlook)
          const gmailMessagesByUser = new Map<string, string[]>();
          const outlookMessagesByUser = new Map<string, string[]>();

          for (const msg of messagesToArchive) {
            const userId = msg.user_tokens.clerk_user_id;
            const messageId = msg.message_id;

            if (msg.user_tokens.is_gmail) {
              const existing = gmailMessagesByUser.get(userId) || [];
              existing.push(messageId);
              gmailMessagesByUser.set(userId, existing);
            } else {
              const existing = outlookMessagesByUser.get(userId) || [];
              existing.push(messageId);
              outlookMessagesByUser.set(userId, existing);
            }
          }

          // Process Gmail messages
          for (const [userId, messageIds] of gmailMessagesByUser) {
            try {
              const archiveResult = await archiveGmailMessages(
                userId,
                messageIds,
              );
              if (archiveResult.success) {
                results.archivedGmail += archiveResult.trashed || 0;
                // Only update archive_at for successfully archived IDs
                if (
                  archiveResult.trashedIds &&
                  archiveResult.trashedIds.length > 0
                ) {
                  await db.email_tracked.updateMany({
                    where: {
                      user_id: userId,
                      message_id: { in: archiveResult.trashedIds },
                    },
                    data: {
                      archive_at: now,
                    },
                  });
                }
              } else {
                results.failed += messageIds.length;
              }
            } catch (error) {
              results.failed += messageIds.length;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              results.errors.push(
                `Failed to archive Gmail messages for user ${userId}: ${errorMessage}`,
              );
              console.error(
                `Failed to archive Gmail messages for user ${userId}:`,
                error,
              );
            }
          }

          // Process Outlook messages
          for (const [userId, messageIds] of outlookMessagesByUser) {
            try {
              const archiveResult = await archiveMessagesOutlook(
                userId,
                messageIds,
              );
              if (archiveResult.success) {
                results.archivedOutlook += archiveResult.archived || 0;
                // Only update archive_at for successfully archived IDs
                if (
                  archiveResult.archivedIds &&
                  archiveResult.archivedIds.length > 0
                ) {
                  await db.email_tracked.updateMany({
                    where: {
                      user_id: userId,
                      message_id: { in: archiveResult.archivedIds },
                    },
                    data: {
                      archive_at: now,
                    },
                  });
                }
              } else {
                results.failed += messageIds.length;
              }
            } catch (error) {
              results.failed += messageIds.length;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              results.errors.push(
                `Failed to archive Outlook messages for user ${userId}: ${errorMessage}`,
              );
              console.error(
                `Failed to archive Outlook messages for user ${userId}:`,
                error,
              );
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          results.errors.push(
            `Failed to process rule for domain ${rule.domain}: ${errorMessage}`,
          );
          console.error(
            `Failed to process archive rule for domain ${rule.domain}:`,
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

            // Sleep for 500ms to avoid hitting Resend rate limits
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
          // Check if already sent today
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

          // Skip free users entirely
          if (pref.user_tokens.tier === "FREE") {
            results.skipped++;
            continue;
          }

          const count = await getDigestCount(userId);

          if (count === 0) {
            // Send "all caught up" email
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
            const digest = await getDigestForUser(userId);
            const totalEmails = digest.reduce((sum, g) => sum + g.emails.length, 0);
            const trimmed = trimDigestForEmail(digest, 10);
            const shownCount = trimmed.groups.reduce((sum, g) => sum + g.emails.length, 0);
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
              })
            );

            await resend.emails.send({
              from: "NeatMail <digest@send.neatmail.app>",
              to: userEmail,
              subject: `NeatMail digest: ${shownCount} email${shownCount > 1 ? "s" : ""}`,
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
