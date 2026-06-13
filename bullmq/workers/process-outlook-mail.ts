import { Job } from "bullmq";
import { getGraphClient } from "@/lib/outlook";
import { db } from "@/lib/prisma";
import {
  addMailtoDB,
  labelColor,
  useGetUserDraftPreference,
} from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";
import { isMessageProcessed, markMessageProcessed } from "@/lib/redis";
import { getModelResponse, ModelResponse } from "@/lib/model";
import { checkAndForwardToTelegram } from "@/lib/telegram";
import { flow } from "@/lib/queue";
import { getUserTier } from "@/lib/tier-guard";

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



  const client = await getGraphClient(subscription.clerk_user_id);
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
    classification = await getModelResponse({
      bodySnippet: body,
      from: from,
      subject: subject,
      user_id: subscription.clerk_user_id,
      tags: tagsOfUser.map((t) => ({
        name: t.tag.name,
        description: t.tag.description ?? "",
      })),
      sensitivity: draftsenstivity || "if actionable",
    });
    labelName = classification.category;
    responseRequired = classification.response_required === true;
  }

  const shouldDraft =
    (labelName === "Pending Response" || labelName === "Action Needed") &&
    responseRequired;

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

    checkAndForwardToTelegram(
      subscription.clerk_user_id,
      from,
      subject,
      body,
      tagProperties.id,
      tagProperties.name,
    );
  }

  if (shouldDraft) {
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

  return { success: true, from, subject };
}

export default processOutlookMail;
