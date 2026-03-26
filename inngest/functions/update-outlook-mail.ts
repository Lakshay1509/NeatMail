import { getGraphClient } from "@/lib/outlook";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/prisma";
import { updateMessageStatus } from "@/lib/supabase";
import { handleOutlookLabelCorrection } from "@/lib/outlook-correction";

export const updateOutlookMailFn = inngest.createFunction(
  {
    id: "update-outlook-mail",
    retries: 3,
    onFailure: async ({ event, error }) => {
      console.error(
        `Failed to process Outlook update for message ${event.data.event.data.messageId}:`,
        error,
      );
    },
  },
  { event: "outlook/mail.updated" },
  async ({ event, step }) => {
    const { messageId, subscriptionId } = event.data;

    const subscription = await step.run("lookup-subscription", async () => {
      return db.user_tokens.findFirst({
        where: { outlook_id: subscriptionId },
      });
    });

    if (!subscription) {
      console.warn("No subscription found for subscriptionId:", subscriptionId);
      return { skipped: true };
    }

    const messageData = await step.run("fetch-message-data", async () => {
      try {
        const client = await getGraphClient(subscription.clerk_user_id);
        const mail = await client
          .api(`/me/messages/${messageId}`)
          .select("isRead,categories,subject,bodyPreview")
          .get();
        return mail;
      } catch (err: any) {
        if (err.statusCode === 404) {
          console.warn(`Message ${messageId} not found during update.`);
          return null;
        }
        throw err;
      }
    });

    if (!messageData) {
      return { skipped: true, reason: "not_found" };
    }

    const { isRead, categories, subject, bodyPreview } = messageData;

    await step.run("process-outlook-correction", async () => {
      if (categories && categories.length > 0) {
        await handleOutlookLabelCorrection(
          subscription.clerk_user_id,
          messageId,
          categories,
          subject || "No Subject",
          bodyPreview || ""
        );
      }
    });

    await step.run("update-message-status", async () => {
      await updateMessageStatus(messageId, isRead);
    });

    return { success: true, isRead };
  },
);
