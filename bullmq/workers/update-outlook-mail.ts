import { Job } from "bullmq";
import { getGraphClient } from "@/lib/outlook";
import { db } from "@/lib/prisma";
import { getTaggedEmailCount, updateMessageStatus } from "@/lib/supabase";
import { handleOutlookLabelCorrection } from "@/lib/outlook-correction";
import { getUserTier } from "@/lib/tier-guard";
import { TIER_LIMITS } from "@/lib/tiers";

interface UpdateOutlookMailData {
  messageId: string;
  subscriptionId: string;
}

export async function updateOutlookMail(job: Job<UpdateOutlookMailData>) {
  const { messageId, subscriptionId } = job.data;

  const subscription = await db.user_tokens.findFirst({
    where: { outlook_id: { contains: subscriptionId } },
  });

  if (!subscription) {
    console.warn("No subscription found for subscriptionId:", subscriptionId);
    return { skipped: true };
  }

  const tier = await getUserTier(subscription.clerk_user_id);
  if (tier === "FREE") {
    const taggedCount = await getTaggedEmailCount(subscription.clerk_user_id);
    if (taggedCount >= TIER_LIMITS.FREE.maxTrackedEmails) {
      return { skipped: true, reason: "not subscribed" };
    }
  }

  let messageData;
  try {
    const client = await getGraphClient(subscription.clerk_user_id);
    messageData = await client
      .api(`/me/messages/${messageId}`)
      .select("isRead,categories,subject,bodyPreview")
      .get();
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      console.warn(`Message ${messageId} not found during update.`);
      return { skipped: true, reason: "not_found" };
    }
    throw err;
  }

  if (!messageData) {
    return { skipped: true, reason: "not_found" };
  }

  const { isRead, categories, subject, bodyPreview } = messageData;

  if (categories && categories.length > 0) {
    await handleOutlookLabelCorrection(
      subscription.clerk_user_id,
      messageId,
      categories,
      subject || "No Subject",
      bodyPreview || "",
    );
  }

  await updateMessageStatus(messageId, isRead);

  return { success: true, isRead };
}

export default updateOutlookMail;
