import { createOutlookDraft, getGraphClient } from "@/lib/outlook";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/prisma";
import {
  addMailtoDB,
  labelColor,
  useGetUserDraftPreference,
} from "@/lib/supabase";
import {
  classifyEmail as classifyEmailOpenAI,
  
} from "@/lib/openai";
import { clerkClient } from "@clerk/nextjs/server";
import { isMessageProcessed, markMessageProcessed } from "@/lib/redis";
import { parseFromHeader } from "@/app/api/[[...route]]/gmail-webhook";
import { getModelResponse } from "@/lib/model";

export const processOutlookMailFn = inngest.createFunction(
  {
    id: "process-outlook-mail",
    retries: 5,
    onFailure: async ({ event, error }) => {
      console.error(
        `Permanently failed to process Outlook message ${event.data.event.data.messageId}:`,
        error,
      );
    },
  },
  { event: "outlook/mail.received" },
  async ({ event, step }) => {
    const { messageId, subscriptionId } = event.data;

    // Redis guard: skip if this messageId was already processed.
    // This handles the case where moving the email to a folder triggers
    // a second Graph notification for the same messageId.
    const alreadyProcessed = await step.run("check-duplicate", async () => {
      return isMessageProcessed(messageId);
    });

    if (alreadyProcessed) {
      console.log(`Skipping duplicate Outlook message: ${messageId}`);
      return { skipped: true, reason: "duplicate" };
    }

    // Claim this messageId immediately so a concurrent/retried run can't
    // sneak past the check above before the folder-move fires.
    await step.run("claim-message", async () => {
      await markMessageProcessed(messageId);
    });

    const subscription = await step.run("lookup-subscription", async () => {
      return db.user_tokens.findFirst({
        where: { outlook_id: subscriptionId },
      });
    });

    if (!subscription) {
      console.warn("No subscription found for subscriptionId:", subscriptionId);
      return { skipped: true };
    }

    const mail = await step.run("fetch-mail", async () => {
      const client = await getGraphClient(subscription.clerk_user_id);
      return client
        .api(`/me/messages/${messageId}`)
        .header("Prefer", 'outlook.body-content-type="text"')
        .get();
    });

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
    const subject: string = mail.subject ?? "";
    const body: string = mail.body?.content ?? "";

    const client = await clerkClient();
    const clerkUser = await client.users.getUser(subscription.clerk_user_id);

    const draftsenstivity = await step.run("draft-senstivity",async()=>{
      return (await useGetUserDraftPreference(clerkUser.id)).senstivity
    })


    const classification = await step.run("model-called", async () => {
      return getModelResponse(
        {
          bodySnippet: body,
          from: from,
          subject: subject,
          user_id: subscription.clerk_user_id,
          tags: tagsOfUser.map((t) => ({ name: t.tag.name, description: t.tag.description ?? '' })),
          sensitivity: draftsenstivity || "if actionable",
        }
      );
    });
    
    let labelName = classification.category;
    
    

    const shouldDraft =
        (labelName === "Pending Response" || labelName === "Action Needed"  ) && classification.response_required;

    let movedMessageId: string = messageId;

    if(labelName.trim().length===0){
       addMailtoDB(subscription.clerk_user_id, null, movedMessageId,from);
    }

    if (labelName.trim().length > 0) {
      const tagProperties = await labelColor(
        labelName,
        subscription.clerk_user_id,
      );

      movedMessageId = await step.run("mark-processed", async () => {
        const client = await getGraphClient(subscription.clerk_user_id);

        // Ensure a master category exists with the label name and the user's chosen color preset
        const categoriesResponse = await client
          .api("/me/outlook/masterCategories")
          .get();
        const existingCategory = categoriesResponse.value?.find(
          (c: any) => c.displayName === labelName,
        );
        if (!existingCategory) {
          await client.api("/me/outlook/masterCategories").post({
            displayName: labelName,
            ...(tagProperties.outlook_preset
              ? { color: tagProperties.outlook_preset }
              : {}),
          });
        } else if (
          tagProperties.outlook_preset &&
          existingCategory.color !== tagProperties.outlook_preset
        ) {
          // Update the color if it doesn't match what's stored
          await client
            .api(`/me/outlook/masterCategories/${existingCategory.id}`)
            .delete();

          await client.api("/me/outlook/masterCategories").post({
            displayName: labelName,
            color: tagProperties.outlook_preset,
          });
        }

        if (subscription.is_folder === true) {
          // Find existing folder with the label name
          const foldersResponse = await client
            .api("/me/mailFolders")
            .filter(`displayName eq '${labelName}'`)
            .get();

          let folderId: string;

          if (foldersResponse.value && foldersResponse.value.length > 0) {
            folderId = foldersResponse.value[0].id;
          } else {
            // Create a new folder if it doesn't exist
            const newFolder = await client.api("/me/mailFolders").post({
              displayName: labelName,
            });
            folderId = newFolder.id;
          }

          // Move the message to the folder — Outlook assigns a new ID after move
          const movedMessage = await client
            .api(`/me/messages/${messageId}/move`)
            .post({
              destinationId: folderId,
            });

          // Assign the category to the moved message so the color is visible in Outlook
          await client.api(`/me/messages/${movedMessage.id}`).patch({
            categories: [labelName],
          });

          return movedMessage.id as string;
        } else {
          await client.api(`/me/messages/${movedMessageId}`).patch({
            categories: [labelName],
          });
          return movedMessageId;
        }
      });
      addMailtoDB(subscription.clerk_user_id, tagProperties.id, movedMessageId,from);
    }

    if (shouldDraft) {
      await step.run("draft", async () => {
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
        };

        const { senderName, senderEmail } = parseFromHeader(emailData.from);
        await inngest.send({
          name: "email/process.draft",
          data: {
            userId: clerkUser.id,
            emailData: {
              ...emailData,
              receivedAt: new Date().toISOString(),
            },
            senderName: senderName,
            senderEmail: senderEmail,
            messageId: movedMessageId,
            tokenData: accessToken,
            is_gmail: false,
          },
        });
      });
    }

    return { success: true, from, subject };
  },
);
