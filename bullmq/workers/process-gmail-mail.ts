import { DelayedError, Job } from "bullmq";
import { clerkClient } from "@clerk/nextjs/server";
import { getGmailClient, getGmailMessageBody } from "@/lib/gmail";
import {
  isMessageProcessed,
  markMessageProcessed,
  unmarkMessageProcessed,
} from "@/lib/redis";
import {
  addMailtoDB,
  getTagsUser,
  getUserByEmail,
  labelColor,
  useGetUserDraftPreference,
} from "@/lib/supabase";
import { getUserTier } from "@/lib/tier-guard";
import { getModelResponse, ModelResponse } from "@/lib/model";
import { checkAndForwardToTelegram } from "@/lib/telegram";
import { db } from "@/lib/prisma";
import { encrypt, encryptDomain, decrypt } from "@/lib/encode";
import { isPromiseCandidate, extractInboundPromise } from "@/lib/promise";
import { markBufferedEmailArchived } from "@/lib/batch-insert";
import { draftQueue, followUpQueue } from "@/lib/queue";
import { gmailUserBurstLimiter } from "@/lib/rate-limit";

interface ProcessGmailMailData {
  clerkUserId: string;
  emailAddress: string;
  messageId: string;
}

function parseFromHeader(fromHeader: string): {
  senderName: string;
  senderEmail: string;
} {
  const emailMatch = fromHeader.match(/<([^>]+)>/);
  const senderEmail = (emailMatch?.[1] || fromHeader).trim();
  const senderName = fromHeader
    .replace(/<[^>]+>/, "")
    .replace(/"/g, "")
    .trim();

  return {
    senderName: senderName || senderEmail,
    senderEmail,
  };
}

function extractEmailsFromHeader(header: string): string[] {
  const emails: string[] = [];
  const angleMatches = header.matchAll(/<([^>]+)>/g);
  for (const match of angleMatches) {
    emails.push(match[1].toLowerCase().trim());
  }
  if (emails.length === 0) {
    for (const part of header.split(",")) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed.includes("@")) {
        emails.push(trimmed);
      }
    }
  }
  return emails;
}

export async function processGmailMail(
  job: Job<ProcessGmailMailData>,
  token?: string,
) {
  const { clerkUserId, emailAddress, messageId } = job.data;

  if (await isMessageProcessed(messageId)) {
    return { skipped: true, reason: "duplicate" };
  }

  // Per-user cap, separate from the queue-wide limiter: a flooded mailbox
  // (mail-bombing, a runaway script) shouldn't be able to occupy the shared
  // worker capacity that every other user's mail also drains through. Delay
  // rather than fail so it just drips through once the window clears, without
  // burning one of the job's retry attempts.
  const burst = await gmailUserBurstLimiter.limit(clerkUserId);
  if (!burst.success && token) {
    await job.moveToDelayed(Date.now() + 5000, token);
    throw new DelayedError();
  }

  // Mark as processed immediately to prevent race conditions; cleared on
  // failure below so a BullMQ retry can actually reprocess the message.
  await markMessageProcessed(messageId);

  try {
    // Defense-in-depth: re-check deletion/tier status at process time, since
    // a job may sit in the queue for a while behind a rate limiter.
    const user = await getUserByEmail(emailAddress);
    if (!user || user.deleted_flag) {
      return { skipped: true, reason: "user deleted" };
    }

    const tier = await getUserTier(clerkUserId);
    if (tier === "FREE") {
      return { skipped: true, reason: "not subscribed" };
    }

    const gmail = await getGmailClient(clerkUserId);

    let email;
    try {
      email = await gmail.users.messages.get({ userId: "me", id: messageId });
    } catch (err: any) {
      if (err.code === 404 || err.status === 404) {
        return { skipped: true, reason: "message not found" };
      }
      throw err;
    }

    const fullBody = await getGmailMessageBody(clerkUserId, messageId);
    const truncatedBody = fullBody?.slice(0, 300);

    const emailData = {
      userId: clerkUserId,
      subject:
        email.data.payload?.headers?.find((h) => h.name === "Subject")
          ?.value || "",
      from:
        email.data.payload?.headers?.find((h) => h.name === "From")?.value ||
        "",
      bodySnippet: truncatedBody,
      threadId: email.data.threadId || "",
    };

    const toHeader =
      email.data.payload?.headers?.find((h) => h.name === "To")?.value || "";
    const toEmails = extractEmailsFromHeader(toHeader);
    const isDirectTo = toEmails.includes(emailAddress.toLowerCase());

    if (emailData.threadId) {
      await followUpQueue.remove(`follow-up:gmail:${emailData.threadId}`);
    }

    const tagsOfUser = await getTagsUser(clerkUserId);
    const draftsenstivity = (await useGetUserDraftPreference(clerkUserId))
      .senstivity;

    let labelName = "";
    let responseRequired = false;
    let classificationResult: ModelResponse | null = null;

    const { senderEmail: fromEmail } = parseFromHeader(emailData.from);
    if (fromEmail === "digest@send.neatmail.app") {
      const hasAumNeededTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Automated alerts",
      );
      if (!hasAumNeededTag) {
        return { skipped: true, reason: "digest email, no automated alert tag" };
      }
      labelName = "Automated alerts";
    }

    if (!labelName) {
      const hasMarketingTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Marketing",
      );
      const hasReadonlyTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Read only",
      );
      const hasAutomatedAlertTag = tagsOfUser.some(
        (tag) => tag.tag.name === "Automated alerts",
      );

      if (
        email.data.labelIds?.includes("CATEGORY_PROMOTIONS") &&
        hasMarketingTag
      ) {
        labelName = "Marketing";
      } else if (
        hasReadonlyTag &&
        email.data.labelIds?.includes("CATEGORY_SOCIAL")
      ) {
        labelName = "Read only";
      } else if (
        (email.data.labelIds?.includes("CATEGORY_PROMOTIONS") ||
          email.data.labelIds?.includes("CATEGORY_SOCIAL")) &&
        hasAutomatedAlertTag
      ) {
        labelName = "Automated alerts";
      } else if (isDirectTo) {
        const classification = await getModelResponse({
          bodySnippet: emailData.bodySnippet,
          from: emailData.from,
          subject: emailData.subject,
          user_id: emailData.userId,
          tags: tagsOfUser.map((t) => ({
            name: t.tag.name,
            description: t.tag.description ?? "",
            user_defined: t.tag.user_id !== null,
          })),
          sensitivity: draftsenstivity || "if actionable",
        });
        classificationResult = classification;
        labelName = classification.category;
        responseRequired = classification.response_required === true;
      } else {
        const hasReadOnlyTag = tagsOfUser.some(
          (tag) => tag.tag.name === "Read only",
        );
        if (hasReadOnlyTag) {
          labelName = "Read only";
        }
        responseRequired = false;
      }
    }

    if (emailData.threadId) {
      try {
        const threadData = await gmail.users.threads.get({
          userId: "me",
          id: emailData.threadId,
        });

        const labelsResponse = await gmail.users.labels.list({ userId: "me" });
        const followUpLabelId = labelsResponse.data.labels?.find(
          (l) => l.name === "Follow up",
        )?.id;

        // Promise fulfillment ("they owe me"): when the promiser sends a new
        // message in a thread with an open promise, the debt is delivered.
        // Runs before promise creation and excludes the current message, so a
        // promise can never fulfill itself. from_email is non-deterministically
        // encrypted, so decrypt to compare the exact sender.
        const openThreadPromises = await db.tracked_promise.findMany({
          where: {
            user_id: clerkUserId,
            thread_id: emailData.threadId,
            status: { in: ["PENDING", "NUDGED"] },
            message_id: { not: messageId },
          },
          select: { id: true, message_id: true, from_email: true },
        });

        const fulfilledMessageIds = new Set<string>();
        if (openThreadPromises.length) {
          const senderNow = fromEmail.toLowerCase();
          const fulfilledIds: string[] = [];
          for (const p of openThreadPromises) {
            let promiser = "";
            try {
              promiser = (await decrypt(p.from_email)).toLowerCase();
            } catch {
              continue;
            }
            if (promiser === senderNow) {
              fulfilledIds.push(p.id);
              fulfilledMessageIds.add(p.message_id);
            }
          }
          if (fulfilledIds.length) {
            await db.tracked_promise.updateMany({
              where: { id: { in: fulfilledIds } },
              data: { status: "FULFILLED", fulfilled_at: new Date() },
            });
            console.log(
              `[promise] Fulfilled ${fulfilledIds.length} promise(s) on thread ${emailData.threadId} — promiser replied`,
            );
          }
        }

        // Message ids still carrying an OPEN promise must survive the reply-cancel
        // below; only fulfillment or a manual dismiss clears a promise's label.
        const openPromiseMessageIds = new Set(
          openThreadPromises
            .filter((p) => !fulfilledMessageIds.has(p.message_id))
            .map((p) => p.message_id),
        );

        if (followUpLabelId) {
          const messagesWithFollowUp = threadData.data.messages?.filter((m) =>
            m.labelIds?.includes(followUpLabelId),
          );

          if (messagesWithFollowUp?.length) {
            for (const msg of messagesWithFollowUp) {
              if (msg.id && openPromiseMessageIds.has(msg.id)) continue;
              await gmail.users.messages.modify({
                userId: "me",
                id: msg.id!,
                requestBody: { removeLabelIds: [followUpLabelId] },
              });
              console.log(`[gmail-followup] Removed "Follow up" from ${msg.id}`);
            }
          }
        }
      } catch (err: any) {
        console.error(
          `[gmail-followup] Error removing "Follow up" for thread ${emailData.threadId}: ${err.message}`,
        );
      }
    }

    // --- Inbound promise tracking ("they owe me") ---
    // Opt-in per user. The zero-cost regex gate runs first, so the nano
    // extractor only fires on the rare mail that actually looks like a dated
    // commitment. Wrapped so it can never break mail processing.
    if (
      isDirectTo &&
      emailData.threadId &&
      fromEmail.toLowerCase() !== emailAddress.toLowerCase()
    ) {
      try {
        const followUpPref = await db.follow_up_preference.findUnique({
          where: { user_id: clerkUserId },
          select: { track_promises: true },
        });
        if (
          followUpPref?.track_promises &&
          isPromiseCandidate({
            fromEmail,
            subject: emailData.subject,
            body: fullBody ?? "",
          })
        ) {
          const draftPref = await useGetUserDraftPreference(clerkUserId);
          const receivedDate = email.data.internalDate
            ? new Date(Number(email.data.internalDate))
            : new Date();
          const promise = await extractInboundPromise({
            subject: emailData.subject,
            body: fullBody ?? "",
            fromEmail,
            receivedDate,
            userTimezone: draftPref.timezone ?? "UTC",
          });
          if (promise) {
            const domain = fromEmail.split("@")[1] || null;
            // item + from_email are body-derived PII: encrypt at rest, same as
            // email_tracked.ai_summary. domain uses encryptDomain for parity.
            await db.tracked_promise.upsert({
              where: {
                user_id_message_id: {
                  user_id: clerkUserId,
                  message_id: messageId,
                },
              },
              update: {},
              create: {
                user_id: clerkUserId,
                thread_id: emailData.threadId,
                message_id: messageId,
                from_email: await encrypt(fromEmail),
                from_domain: domain ? await encryptDomain(domain) : null,
                item: await encrypt(promise.item),
                due_at: promise.dueAt,
                confidence: promise.confidence,
              },
            });
            console.log(
              `[promise] Tracked inbound promise on thread ${emailData.threadId}, due ${promise.dueAt.toISOString()}`,
            );
          }
        }
      } catch (err: any) {
        console.error(`[promise] extraction failed: ${err?.message ?? err}`);
      }
    }

    const shouldDraft =
      (labelName === "Pending Response" || labelName === "Action Needed") &&
      responseRequired;

    // If this isn't actionable and the sender already has an active AUTO rule,
    // archive it on arrival. Re-encrypting emailData.from gives the same
    // ciphertext the scan stored, so this matches without decrypting anything.
    const AUTO_ARCHIVE_EXCLUDED = [
      "Action Needed",
      "Pending Response",
      "Finance",
      "Event update",
    ];
    let autoArchive = false;
    if (
      labelName.trim().length > 0 &&
      !AUTO_ARCHIVE_EXCLUDED.includes(labelName)
    ) {
      try {
        const encryptedFrom = await encryptDomain(emailData.from);
        const autoRule = await db.archiveRule.findUnique({
          where: {
            user_id_domain: { user_id: clerkUserId, domain: encryptedFrom },
          },
          select: { isActive: true, source: true },
        });
        autoArchive =
          !!autoRule && autoRule.isActive && autoRule.source === "AUTO";
      } catch (err) {
        console.error("[gmail-auto-archive] rule lookup failed:", err);
      }
    }

    if (labelName === "" && !shouldDraft) {
      await addMailtoDB(clerkUserId, null, String(messageId), emailData.from);
      return { success: true, labeled: false };
    }

    if (labelName.trim().length > 0) {
      const colourofLabel = await labelColor(labelName, clerkUserId);

      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      let labelId = labelsResponse.data.labels?.find(
        (l) => l.name === labelName,
      )?.id;

      if (!labelId) {
        const newLabel = await gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
            color: {
              textColor: "#ffffff",
              backgroundColor: colourofLabel.color,
            },
          },
        });
        labelId = newLabel.data.id!;
      }

      try {
        await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            addLabelIds: [labelId],
            // Auto-muted senders get INBOX dropped in the same call that labels them.
            ...(autoArchive ? { removeLabelIds: ["INBOX"] } : {}),
          },
        });
      } catch (err: any) {
        if (err.code === 404 || err.status === 404) {
          return { skipped: true, reason: "message deleted before label applied" };
        }
        throw err;
      }

      const { senderEmail } = parseFromHeader(emailData.from);
      // Skip the Telegram ping for mail we just auto-archived.
      if (!autoArchive) {
        await checkAndForwardToTelegram(
          clerkUserId,
          senderEmail,
          emailData.subject,
          fullBody,
          colourofLabel.id,
          colourofLabel.name,
        );
      }

      await addMailtoDB(
        clerkUserId,
        colourofLabel.id,
        String(messageId),
        emailData.from,
        classificationResult?.ai_summary,
        classificationResult?.ai_action,
      );

      // Stamp archive_at through the batch to match the Gmail modify above.
      if (autoArchive) {
        await markBufferedEmailArchived(
          String(messageId),
          new Date().toISOString(),
        );
      }
    }

    if (shouldDraft && isDirectTo) {
      const client = await clerkClient();
      const userDataFromClerk = await client.users.getUser(clerkUserId);
      const fullName = `${userDataFromClerk.fullName ?? ""}`.trim();

      const tokenResponse = await client.users.getUserOauthAccessToken(
        clerkUserId,
        "google",
      );
      const tokenData = tokenResponse.data[0]?.token;

      const { senderName, senderEmail } = parseFromHeader(emailData.from);
      await draftQueue.add("process-draft", {
        userName: fullName,
        userId: clerkUserId,
        emailData: {
          ...emailData,
          receivedAt: new Date().toISOString(),
        },
        senderName: senderName,
        senderEmail: senderEmail,
        messageId: messageId,
        tokenData: tokenData,
        is_gmail: true,
      });
    }

    return { success: true, labeled: labelName.trim().length > 0 };
  } catch (error) {
    await unmarkMessageProcessed(messageId);
    throw error;
  }
}

export default processGmailMail;
