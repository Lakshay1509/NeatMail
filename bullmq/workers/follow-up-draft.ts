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

  if (aiDrafts !== false) {
    const followUpBody = await generateFollowUpMessage({ subject, body, to });
    if (followUpBody) {
      if (isGmail) {
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
      } else {
        await createOutlookDraft(
          userId,
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
  }

  if (isGmail) {
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
  } else {
    const graphClient = await getGraphClient(userId);

    const categoriesResponse = await graphClient
      .api("/me/outlook/masterCategories")
      .get();
    const existingCategory = categoriesResponse.value?.find(
      (c: { displayName?: string }) => c.displayName === "Follow up",
    );

    if (!existingCategory) {
      await graphClient.api("/me/outlook/masterCategories").post({
        displayName: "Follow up",
        color: "preset5",
      });
    }

    await graphClient.api(`/me/messages/${messageId}`).patch({
      categories: ["Follow up"],
    });
  }

  await addMailtoDB(userId, null, messageId, to, `send follow up to ${to}`, "follow up required");

  console.log(
    `[follow-up-draft] Applied "Follow up" label to ${messageId} (${isGmail ? "gmail" : "outlook"})`,
  );

  return { status: "success" };
}

export default processFollowUpDraft;
