import { Job } from "bullmq";
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
import { draftQueue, followUpQueue } from "@/lib/queue";

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

export async function processGmailMail(job: Job<ProcessGmailMailData>) {
  const { clerkUserId, emailAddress, messageId } = job.data;

  if (await isMessageProcessed(messageId)) {
    return { skipped: true, reason: "duplicate" };
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

        if (followUpLabelId) {
          const messagesWithFollowUp = threadData.data.messages?.filter((m) =>
            m.labelIds?.includes(followUpLabelId),
          );

          if (messagesWithFollowUp?.length) {
            for (const msg of messagesWithFollowUp) {
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

    const shouldDraft =
      (labelName === "Pending Response" || labelName === "Action Needed") &&
      responseRequired;

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
          requestBody: { addLabelIds: [labelId] },
        });
      } catch (err: any) {
        if (err.code === 404 || err.status === 404) {
          return { skipped: true, reason: "message deleted before label applied" };
        }
        throw err;
      }

      const { senderEmail } = parseFromHeader(emailData.from);
      await checkAndForwardToTelegram(
        clerkUserId,
        senderEmail,
        emailData.subject,
        fullBody,
        colourofLabel.id,
        colourofLabel.name,
      );

      await addMailtoDB(
        clerkUserId,
        colourofLabel.id,
        String(messageId),
        emailData.from,
        classificationResult?.ai_summary,
        classificationResult?.ai_action,
      );
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
