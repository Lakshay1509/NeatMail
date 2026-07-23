import { Job } from "bullmq";
import { getGraphClient, OAuthError, archiveMessagesOutlook } from "@/lib/outlook";
import { db } from "@/lib/prisma";
import { encrypt, encryptDomain, decrypt } from "@/lib/encode";
import {
  isPromiseCandidate,
  extractInboundPromise,
  isOutboundPromiseCandidate,
  extractOutboundPromise,
  NUDGE_LEAD_MS,
} from "@/lib/promise";
import { markBufferedEmailArchived } from "@/lib/batch-insert";
import {
  addMailtoDB,
  labelColor,
  useGetUserDraftPreference,
  checkFollowUpLimit,
  incrementFollowUpCount,
} from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";
import {
  isMessageProcessed,
  markMessageProcessed,
  claimReconnectReminder,
  releaseReconnectReminder,
} from "@/lib/redis";
import { sendReconnectEmail } from "@/lib/resend";
import { getModelResponse, ModelResponse } from "@/lib/model";
import { checkAndForwardToTelegram } from "@/lib/telegram";
import { flow, followUpQueue, promiseNudgeQueue } from "@/lib/queue";
import { getUserTier } from "@/lib/tier-guard";
import { isMemberAccessPaused } from "@/lib/organization";
import { checkSentRequiresFollowUp } from "@/lib/sent-followup";

interface ProcessOutlookMailData {
  messageId: string;
  subscriptionId: string;
}

export async function processOutlookMail(job: Job<ProcessOutlookMailData>) {
  const { messageId, subscriptionId } = job.data;

  const alreadyProcessed = await isMessageProcessed(messageId);

  if (alreadyProcessed) {
    console.log(`Skipping duplicate Outlook message: ${messageId}`);
    return { skipped: true, reason: "duplicate" };
  }

  await markMessageProcessed(messageId);

  const subscription = await db.user_tokens.findFirst({
    where: { outlook_id: { contains: subscriptionId } },
  });

  if (!subscription) {
    console.warn("No subscription found for subscriptionId:", subscriptionId);
    return { skipped: true };
  }

  // Skip users scheduled for deletion; defense-in-depth in case the Outlook subscription lingers before expiry.
  if (subscription.deleted_flag) {
    return { skipped: true, reason: "user scheduled for deletion" };
  }

  // const activeSubcription = await getUserSubscribed(
  //   subscription.clerk_user_id,
  // );

  // if (activeSubcription.subscribed === false) {
  //   return { skipped: true, reason: "not subscribed" };
  // }

  const tier = await getUserTier(subscription.clerk_user_id);
  if (tier === "FREE") {
    return { skipped: true, reason: "not subscribed" };
  }

  // Paused members keep their inherited tier, so the tier check above passes.
  // Subscription is deleted when paused, but skip here too in case a notification is in-flight.
  if (await isMemberAccessPaused(subscription.clerk_user_id)) {
    return { skipped: true, reason: "member access paused" };
  }

  let client;
  try {
    client = await getGraphClient(subscription.clerk_user_id);
  } catch (err) {
    if (err instanceof OAuthError) {
      // Token revoked/removed (e.g. user pulled access from the Microsoft
      // dashboard). Nudge them to reconnect, throttled to once per few days so
      // the notification flood doesn't spam. Ack the job — retrying can't help
      // until they reconnect. Mirrors the Gmail webhook's reconnect flow.
      console.log(
        `[outlook-webhook] OAuth token unavailable for ${subscription.email} — acking`,
      );
      if (await claimReconnectReminder(subscription.clerk_user_id)) {
        try {
          let fullName = "";
          try {
            const clerk = await clerkClient();
            const clerkUser = await clerk.users.getUser(
              subscription.clerk_user_id,
            );
            fullName = `${clerkUser.fullName ?? ""}`.trim();
          } catch {
            // Name is best-effort; send the nudge with an empty name rather
            // than skip it over a failed profile lookup.
          }
          await sendReconnectEmail(subscription.email, fullName, "Microsoft");
          console.log(
            `[outlook-webhook] Sent reconnect reminder to ${subscription.email}`,
          );
        } catch (e) {
          // Release the claim so a later notification can retry the send.
          await releaseReconnectReminder(subscription.clerk_user_id);
          console.error(
            `[outlook-webhook] Failed to send reconnect reminder to ${subscription.email}`,
            e,
          );
        }
      }
      return { skipped: true, reason: "token revoked" };
    }
    throw err;
  }

  const mail = await client
    .api(`/me/messages/${messageId}`)
    .header("Prefer", 'outlook.body-content-type="text"')
    .get();

  const tagsOfUser = await db.user_tags.findMany({
    where: {
      user_id: subscription.clerk_user_id,
    },
    include: {
      tag: {
        select: {
          name: true,
          description: true,
          user_id: true,
        },
      },
    },
  });

  if (!tagsOfUser || tagsOfUser.length === 0) {
    console.warn("No tags found for user");
    return { skipped: true };
  }

  const from: string = mail.from?.emailAddress?.address ?? "";
  const senderName: string = mail.from?.emailAddress?.name ?? "";
  const subject: string = mail.subject ?? "";
  const body: string = mail.body?.content ?? "";
  const threadId: string = mail.conversationId ?? messageId;

  const sentItemsFolder = await client.api("/me/mailFolders/SentItems").get();
  const isSentMessage = mail.parentFolderId === sentItemsFolder.id;

  if (isSentMessage) {
    // --- Outbound promise tracking ("I owe them") — Outlook ---
    // Independent of the follow-up feature: gated only on track_promises.
    // Fulfillment first (excluding the current message) so a promise can't fulfill
    // itself, then a fresh promise is extracted. Wrapped so it can't break sent processing.
    if (threadId) {
      try {
        const openOutbound = await db.tracked_promise.findMany({
          where: {
            user_id: subscription.clerk_user_id,
            thread_id: threadId,
            direction: "OUTBOUND",
            status: { in: ["PENDING", "NUDGED"] },
            message_id: { not: messageId },
          },
          select: { id: true },
        });
        if (openOutbound.length) {
          await db.tracked_promise.updateMany({
            where: { id: { in: openOutbound.map((o) => o.id) } },
            data: { status: "FULFILLED", fulfilled_at: new Date() },
          });
          for (const o of openOutbound) {
            await promiseNudgeQueue.remove(`promise-nudge-${o.id}`);
          }
          console.log(
            `[promise] Fulfilled ${openOutbound.length} outbound promise(s) on conversation ${threadId} — user sent again (outlook)`,
          );
        }

        const followUpPref = await db.follow_up_preference.findUnique({
          where: { user_id: subscription.clerk_user_id },
          select: { track_promises: true },
        });
        const toEmail = mail.toRecipients?.[0]?.emailAddress?.address ?? "";
        if (
          followUpPref?.track_promises &&
          toEmail &&
          isOutboundPromiseCandidate({ subject, body })
        ) {
          const draftPref = await useGetUserDraftPreference(
            subscription.clerk_user_id,
          );
          const sentDate = mail.sentDateTime
            ? new Date(mail.sentDateTime)
            : new Date();
          const promise = await extractOutboundPromise({
            subject,
            body,
            toEmail,
            sentDate,
            userTimezone: draftPref.timezone ?? "UTC",
          });
          if (promise) {
            const domain = toEmail.split("@")[1] || null;
            const row = await db.tracked_promise.upsert({
              where: {
                user_id_message_id: {
                  user_id: subscription.clerk_user_id,
                  message_id: messageId,
                },
              },
              update: {},
              create: {
                user_id: subscription.clerk_user_id,
                thread_id: threadId,
                message_id: messageId,
                from_email: await encrypt(toEmail),
                from_domain: domain ? await encryptDomain(domain) : null,
                item: await encrypt(promise.item),
                due_at: promise.dueAt,
                confidence: promise.confidence,
                direction: "OUTBOUND",
              },
              select: { id: true },
            });
            const delay = Math.max(
              0,
              promise.dueAt.getTime() - NUDGE_LEAD_MS - Date.now(),
            );
            await promiseNudgeQueue.add(
              "nudge",
              { promiseId: row.id },
              { delay, jobId: `promise-nudge-${row.id}` },
            );
            console.log(
              `[promise] Tracked outbound promise on conversation ${threadId}, nudge in ~${Math.round(delay / 60000)}m (due ${promise.dueAt.toISOString()}) (outlook)`,
            );
          }
        }
      } catch (err: any) {
        console.error(
          `[promise] outbound extraction failed (outlook): ${err?.message ?? err}`,
        );
      }
    }

    const needsFollowUp = await checkSentRequiresFollowUp({
      subject,
      body,
      to: mail.toRecipients?.[0]?.emailAddress?.address ?? "",
    });

    console.log(
      `[outlook-sent-followup] ${messageId} → ${needsFollowUp ? "follow-up needed" : "no follow-up needed"}`,
    );

    if (needsFollowUp) {
      const pref = await db.follow_up_preference.findUnique({
        where: { user_id: subscription.clerk_user_id },
      });

      if (pref?.enabled) {
        const toEmail =
          mail.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() ?? "";
        const skipList = (pref.skip_emails ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

        const shouldSkip = skipList.some((skip) => toEmail.includes(skip));

        if (!shouldSkip) {
          const withinLimit = await checkFollowUpLimit(subscription.clerk_user_id);
          if (!withinLimit) {
            console.log(
              `[outlook-sent-followup] ${messageId} → skipped (monthly limit reached)`,
            );
            return { success: true, sent: true, needsFollowUp, skippedDueToLimit: true };
          }
          await incrementFollowUpCount(subscription.clerk_user_id);
          await followUpQueue.remove(`follow-up:outlook:${threadId}`);
          await followUpQueue.add(
            "follow-up",
            {
              userId: subscription.clerk_user_id,
              messageId,
              threadId,
              subject,
              to: mail.toRecipients?.[0]?.emailAddress?.address ?? "",
              body,
              isGmail: false,
              aiDrafts: pref.ai_drafts,
            },
            {
              delay: pref.days * 24 * 60 * 60 * 1000,
              jobId: `follow-up-outlook-${threadId}`,
            },
          );
        }
      }
    }

    return { success: true, sent: true, needsFollowUp };
  }

  const userEmail = subscription.email.toLowerCase();
  const toEmails = (mail.toRecipients ?? []).map(
    (r: any) => r.emailAddress?.address?.toLowerCase(),
  ).filter(Boolean);

  const isDirectTo = toEmails.includes(userEmail);

  if (threadId) {
    await followUpQueue.remove(`follow-up:outlook:${threadId}`);
  }

  const clerk = await clerkClient();
  const clerkUser = await clerk.users.getUser(subscription.clerk_user_id);

  const draftsenstivity = (
    await useGetUserDraftPreference(clerkUser.id)
  ).senstivity;

  let labelName = "";
  let responseRequired = false;
  let classification: ModelResponse | undefined;

  if (from === "digest@send.neatmail.app") {
    const hasAumNeededTag = tagsOfUser.some(
      (tag) => tag.tag.name === "Automated alerts",
    );
    if (!hasAumNeededTag) {
      return { skipped: true, reason: "digest email, no auomated alert tag" };
    }
    labelName = "Automated alerts";
  }

  if (!labelName) {
    if (isDirectTo) {
      classification = await getModelResponse({
        bodySnippet: body,
        from: from,
        subject: subject,
        user_id: subscription.clerk_user_id,
        tags: tagsOfUser.map((t) => ({
          name: t.tag.name,
          description: t.tag.description ?? "",
          user_defined: t.tag.user_id !== null,
        })),
        sensitivity: draftsenstivity || "if actionable",
      });
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

  // --- Inbound promise tracking ("they owe me") — Outlook ---
  // Fulfillment first (before creation, excluding the current message) so a
  // promise can't fulfill itself. Delivery detection rides on the Inbox watch:
  // the promiser's reply lands here as a normal incoming message.
  if (threadId) {
    try {
      const openThreadPromises = await db.tracked_promise.findMany({
        where: {
          user_id: subscription.clerk_user_id,
          thread_id: threadId,
          status: { in: ["PENDING", "NUDGED"] },
          message_id: { not: messageId },
        },
        select: { id: true, from_email: true },
      });
      if (openThreadPromises.length) {
        const senderNow = from.toLowerCase();
        const fulfilledIds: string[] = [];
        for (const p of openThreadPromises) {
          let promiser = "";
          try {
            promiser = (await decrypt(p.from_email)).toLowerCase();
          } catch {
            continue;
          }
          if (promiser === senderNow) fulfilledIds.push(p.id);
        }
        if (fulfilledIds.length) {
          await db.tracked_promise.updateMany({
            where: { id: { in: fulfilledIds } },
            data: { status: "FULFILLED", fulfilled_at: new Date() },
          });
          console.log(
            `[promise] Fulfilled ${fulfilledIds.length} promise(s) on conversation ${threadId} — promiser replied (outlook)`,
          );
        }
      }
    } catch (err: any) {
      console.error(`[promise] outlook fulfillment failed: ${err?.message ?? err}`);
    }
  }

  if (threadId) {
    const followUpFolderResponse = await client
      .api("/me/mailFolders")
      .filter("displayName eq 'Follow up'")
      .get();

    const followUpFolderId = followUpFolderResponse.value?.[0]?.id;
    if (followUpFolderId) {
      const messagesInFollowUp = await client
        .api(`/me/mailFolders/${followUpFolderId}/messages`)
        .filter(`conversationId eq '${threadId}'`)
        .select("id,subject")
        .get();

      if (messagesInFollowUp.value?.length > 0) {
        const inbox = await client.api("/me/mailFolders/inbox").get();

        for (const msg of messagesInFollowUp.value) {
          const moved = await client
            .api(`/me/messages/${msg.id}/move`)
            .post({ destinationId: inbox.id });

          if (labelName && labelName.trim().length > 0) {
            await client.api(`/me/messages/${moved.id}`).patch({
              categories: [labelName],
            });
          }

          console.log(
            `[outlook-followup] Moved ${msg.id} from "Follow up" to Inbox`,
          );

          await markMessageProcessed(moved.id);
        }
      }
    }
  }

  const shouldDraft =
    (labelName === "Pending Response" || labelName === "Action Needed") &&
    responseRequired;

  // Mirrors the Gmail worker's auto-archive check. `from` is the plain sender
  // address, same as what addMailtoDB encrypts and stores, so re-encrypting it
  // here matches the scan's rule without decrypting anything.
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
      const encryptedFrom = await encryptDomain(from);
      const autoRule = await db.archiveRule.findUnique({
        where: {
          user_id_domain: {
            user_id: subscription.clerk_user_id,
            domain: encryptedFrom,
          },
        },
        select: { isActive: true, source: true },
      });
      autoArchive =
        !!autoRule && autoRule.isActive && autoRule.source === "AUTO";
    } catch (err) {
      console.error("[outlook-auto-archive] rule lookup failed:", err);
    }
  }

  let movedMessageId: string = messageId;

  if (labelName.trim().length === 0) {
    addMailtoDB(subscription.clerk_user_id, null, movedMessageId, from);
  }

  if (labelName.trim().length > 0) {
    const tagProperties = await labelColor(
      labelName,
      subscription.clerk_user_id,
    );

    const graphClient = await getGraphClient(subscription.clerk_user_id);

    const categoriesResponse = await graphClient
      .api("/me/outlook/masterCategories")
      .get();
    const existingCategory = categoriesResponse.value?.find(
      (c: { displayName?: string }) => c.displayName === labelName,
    );

    if (!existingCategory) {
      await graphClient.api("/me/outlook/masterCategories").post({
        displayName: labelName,
        ...(tagProperties.outlook_preset
          ? { color: tagProperties.outlook_preset }
          : {}),
      });
    } else if (
      tagProperties.outlook_preset &&
      existingCategory.color !== tagProperties.outlook_preset
    ) {
      await graphClient
        .api(`/me/outlook/masterCategories/${existingCategory.id}`)
        .delete();
      await graphClient.api("/me/outlook/masterCategories").post({
        displayName: labelName,
        color: tagProperties.outlook_preset,
      });
    }

    if (subscription.is_folder === true) {
      const foldersResponse = await graphClient
        .api("/me/mailFolders")
        .filter(`displayName eq '${labelName}'`)
        .get();

      let folderId: string;

      if (foldersResponse.value && foldersResponse.value.length > 0) {
        folderId = foldersResponse.value[0].id;
      } else {
        const newFolder = await graphClient.api("/me/mailFolders").post({
          displayName: labelName,
        });
        folderId = newFolder.id;
      }

      const movedMessage = await graphClient
        .api(`/me/messages/${messageId}/move`)
        .post({
          destinationId: folderId,
        });

      await graphClient.api(`/me/messages/${movedMessage.id}`).patch({
        categories: [labelName],
      });

      movedMessageId = movedMessage.id as string;
    } else {
      await graphClient.api(`/me/messages/${movedMessageId}`).patch({
        categories: [labelName],
      });
      movedMessageId = movedMessageId;
    }

    addMailtoDB(
      subscription.clerk_user_id,
      tagProperties.id,
      movedMessageId,
      from,
      classification?.ai_summary,
      classification?.ai_action,
    );

    let autoArchived = false;
    if (autoArchive) {
      try {
        if (subscription.is_folder) {
          // The move above already dropped this into the watched label folder,
          // so just mark it archived. Don't move it again into Archive: that
          // folder isn't watched, so a later read wouldn't fire an `updated`
          // notification and un-mute-on-read would stop working.
          await markBufferedEmailArchived(
            movedMessageId,
            new Date().toISOString(),
          );
        } else {
          // Non-folder subscriptions have no watched folder to leave it in, so
          // move it to Archive. That folder isn't watched either, which means
          // un-mute-on-read doesn't work for these users; only explicit Undo does.
          await archiveMessagesOutlook(subscription.clerk_user_id, [
            movedMessageId,
          ]);
          await markBufferedEmailArchived(
            movedMessageId,
            new Date().toISOString(),
          );
        }
        autoArchived = true;
      } catch (err) {
        console.error("[outlook-auto-archive] archive-on-arrival failed:", err);
      }
    }

    // Only skip the notification if the archive actually succeeded; a failed
    // archive leaves the mail visible, so the user should still get pinged.
    if (!autoArchived) {
      checkAndForwardToTelegram(
        subscription.clerk_user_id,
        from,
        subject,
        body,
        tagProperties.id,
        tagProperties.name,
      );
    }
  }

  if (shouldDraft && isDirectTo) {
    const clerk = await clerkClient();
    const externalAccounts = await clerk.users.getUserOauthAccessToken(
      clerkUser.id,
      "microsoft",
    );

    const accessToken = externalAccounts.data[0]?.token;

    if (!accessToken) {
      throw new Error(
        "No Microsoft access token found. User needs to reconnect their Microsoft account.",
      );
    }

    const emailData = {
      userId: clerkUser.id,
      subject: subject,
      from: from,
      bodySnippet: body,
      threadId: threadId,
    };

    await flow.add({
      name: "process-draft",
      queueName: "draft",
      data: {
        userName: clerkUser.fullName,
        userId: clerkUser.id,
        emailData: {
          ...emailData,
          receivedAt: new Date().toISOString(),
        },
        senderName: senderName,
        senderEmail: from,
        messageId: movedMessageId,
        tokenData: accessToken,
        is_gmail: false,
      },
    });
  }

  // Creation: detect a new inbound promise. Placed AFTER labeling so it records
  // the message's FINAL id — for folder-mode users the classification step above
  // moves the mail into a category folder, minting a new id; using the pre-move
  // id would leave the sweep unable to find it (fetch 404 → wrongly dismissed).
  // Opt-in, gated by the zero-cost regex; never track the user's own outbound mail.
  if (isDirectTo && threadId && from.toLowerCase() !== userEmail) {
    try {
      const followUpPref = await db.follow_up_preference.findUnique({
        where: { user_id: subscription.clerk_user_id },
        select: { track_promises: true },
      });
      if (
        followUpPref?.track_promises &&
        isPromiseCandidate({ fromEmail: from, subject, body })
      ) {
        const draftPref = await useGetUserDraftPreference(
          subscription.clerk_user_id,
        );
        const receivedDate = mail.receivedDateTime
          ? new Date(mail.receivedDateTime)
          : new Date();
        const promise = await extractInboundPromise({
          subject,
          body,
          fromEmail: from,
          receivedDate,
          userTimezone: draftPref.timezone ?? "UTC",
        });
        if (promise) {
          const domain = from.split("@")[1] || null;
          await db.tracked_promise.upsert({
            where: {
              user_id_message_id: {
                user_id: subscription.clerk_user_id,
                message_id: movedMessageId,
              },
            },
            update: {},
            create: {
              user_id: subscription.clerk_user_id,
              thread_id: threadId,
              message_id: movedMessageId,
              from_email: await encrypt(from),
              from_domain: domain ? await encryptDomain(domain) : null,
              item: await encrypt(promise.item),
              due_at: promise.dueAt,
              confidence: promise.confidence,
            },
          });
          console.log(
            `[promise] Tracked inbound promise on conversation ${threadId}, due ${promise.dueAt.toISOString()} (outlook, msg ${movedMessageId})`,
          );
        }
      }
    } catch (err: any) {
      console.error(`[promise] outlook extraction failed: ${err?.message ?? err}`);
    }
  }

  return { success: true, from, subject };
}

export default processOutlookMail;
