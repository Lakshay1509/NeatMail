import { Job } from "bullmq";
import { createGmailDraft, getGmailClient } from "@/lib/gmail";
import { createOutlookDraft, getGraphClient } from "@/lib/outlook";
import { useGetUserDraftPreference, addMailtoDB } from "@/lib/supabase";
import { generateFollowUpMessage } from "@/lib/sent-followup";

interface FollowUpDraftData {
  userId: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  body: string;
  isGmail: boolean;
  aiDrafts?: boolean;
}

export async function processFollowUpDraft(job: Job<FollowUpDraftData>) {
  const { userId, messageId, threadId, subject, to, body, isGmail, aiDrafts } =
    job.data;

  const prefs = await useGetUserDraftPreference(userId);

  if (isGmail) {
    if (aiDrafts !== false) {
      const followUpBody = await generateFollowUpMessage({ subject, body, to });
      if (followUpBody) {
        await createGmailDraft(
          userId,
          threadId,
          messageId,
          subject,
          to,
          followUpBody,
          prefs.fontColor,
          prefs.fontSize,
          prefs.signature,
        );
      }
    }

    const gmail = await getGmailClient(userId);

    const labelsResponse = await gmail.users.labels.list({ userId: "me" });
    let labelId = labelsResponse.data.labels?.find(
      (l) => l.name === "Follow up",
    )?.id;

    if (!labelId) {
      const newLabel = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: "Follow up",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
          color: {
            textColor: "#ffffff",
            backgroundColor: "#4a86e8",
          },
        },
      });
      labelId = newLabel.data.id!;
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    await addMailtoDB(userId, null, messageId, to, `send follow up to ${to}`, "follow up required");

    console.log(
      `[follow-up-draft] Applied "Follow up" label to ${messageId} (gmail)`,
    );

    return { status: "success" };
  }

  // --- Outlook path: remove from Sent Items → "Follow up" folder → draft ---
  const graphClient = await getGraphClient(userId);

  const foldersResponse = await graphClient
    .api("/me/mailFolders")
    .filter("displayName eq 'Follow up'")
    .get();

  let folderId: string;
  if (foldersResponse.value && foldersResponse.value.length > 0) {
    folderId = foldersResponse.value[0].id;
  } else {
    const newFolder = await graphClient.api("/me/mailFolders").post({
      displayName: "Follow up",
    });
    folderId = newFolder.id;
  }

  const movedMessage = await graphClient
    .api(`/me/messages/${messageId}/move`)
    .post({
      destinationId: folderId,
    });

  const targetMessageId = movedMessage.id as string;

  if (aiDrafts !== false) {
    const followUpBody = await generateFollowUpMessage({ subject, body, to });
    if (followUpBody) {
      await createOutlookDraft(
        userId,
        targetMessageId,
        subject,
        to,
        followUpBody,
        prefs.fontColor,
        prefs.fontSize,
        prefs.signature,
      );
    }
  }

  await addMailtoDB(userId, null, targetMessageId, to, `send follow up to ${to}`, "follow up required");

  console.log(
    `[follow-up-draft] Moved to "Follow up" folder (id=${targetMessageId}) and applied category (outlook)`,
  );

  return { status: "success" };
}

export default processFollowUpDraft;
