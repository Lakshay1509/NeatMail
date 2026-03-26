import { correctLabel } from "./model";
import { db } from "./prisma";

export async function handleOutlookLabelCorrection(
  clerkUserId: string,
  messageId: string,
  currentCategories: string[],
  subject: string,
  bodyPreview: string,
) {
  try {
    // 1. Fetch user tags to map them to Outlook categories
    const userTags = await db.tag.findMany({
      where: {
        user_tags: { some: { user_id: clerkUserId } },
      },
    });

    if (!userTags.length) return;

    // Create a map of localized tag name to user tag
    const validUserTags = userTags.map((t) => t.name);

    // Filter Outlook categories to only include those that match the user's custom tags
    // (Outlook categories are usually strings matching the tag name)
    const newLabels = currentCategories.filter((cat) =>
      validUserTags.includes(cat),
    );

    // If no applicable user labels are found in the new state, user might have just removed all custom labels, but we only send correction if they added a new correct label (similar to Gmail)
    if (newLabels.length === 0) return;

    const correct_label = newLabels[0];

    // 2. Lookup previous tag assigned to this message in our DB
    const trackedEmail = await db.email_tracked.findUnique({
      where: {
        message_id: messageId,
      },
      include: {
        tag: true,
      },
    });

    let wrong_label: string | undefined;

    if (trackedEmail && trackedEmail.tag) {
      // Only set wrong_label if it differs from correct_label
      if (trackedEmail.tag.name !== correct_label) {
        wrong_label = trackedEmail.tag.name;
      } else {
        // The label in DB is the same as the one in Outlook, so it's not a correction change.
        return;
      }
    }

    // 3. Fire the correction API

    if (correct_label && wrong_label) {
      await correctLabel({
        user_id: clerkUserId,
        subject: subject || "No Subject",
        body: bodyPreview || "",
        correct_label,
        wrong_label,
      });

      console.log(
        `[Outlook Correction] Processed correction for msg ${messageId}: ${
          wrong_label || "None"
        } -> ${correct_label}`,
      );
    }
  } catch (error) {
    console.error(
      `[Outlook Correction] Error processing correction for msg ${messageId}:`,
      error,
    );
  }
}
