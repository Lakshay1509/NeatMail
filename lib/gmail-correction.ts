import { gmail_v1 } from "googleapis";
import { correctLabel } from "./model";
import { getGmailMessageBody } from "./gmail";
import { escapeHtml } from "./telegram";

export async function handleLabelCorrections(
  gmail: gmail_v1.Gmail,
  clerkUserId: string,
  historyRecords: gmail_v1.Schema$History[],
) {
  if (!historyRecords || historyRecords.length === 0) return;

  // Group added and removed labels by message ID
  const messageChanges: Record<
    string,
    { added: Set<string>; removed: Set<string> }
  > = {};

  for (const record of historyRecords) {
    for (const item of record.labelsAdded ?? []) {
      const messageId = item.message?.id;
      if (messageId) {
        if (!messageChanges[messageId]) {
          messageChanges[messageId] = { added: new Set(), removed: new Set() };
        }
        for (const labelId of item.labelIds ?? []) {
          messageChanges[messageId].added.add(labelId);
        }
      }
    }
    for (const item of record.labelsRemoved ?? []) {
      const messageId = item.message?.id;
      if (messageId) {
        if (!messageChanges[messageId]) {
          messageChanges[messageId] = { added: new Set(), removed: new Set() };
        }
        for (const labelId of item.labelIds ?? []) {
          messageChanges[messageId].removed.add(labelId);
        }
      }
    }
  }

  // If no label changes, exit early
  if (Object.keys(messageChanges).length === 0) return;

  // Fetch user labels to filter out system labels and get localized names
  const labelsResponse = await gmail.users.labels.list({ userId: "me" });
  const userLabels = (labelsResponse.data.labels ?? []).filter(
    (l) => l.type === "user",
  );

  const userLabelMap = new Map<string, string>();
  for (const label of userLabels) {
    if (label.id && label.name) {
      userLabelMap.set(label.id, label.name);
    }
  }

  for (const [messageId, changes] of Object.entries(messageChanges)) {
    // Filter out system labels and map to names
    const addedUserLabels = Array.from(changes.added)
      .filter((id) => userLabelMap.has(id))
      .map((id) => userLabelMap.get(id)!);

    const removedUserLabels = Array.from(changes.removed)
      .filter((id) => userLabelMap.has(id))
      .map((id) => userLabelMap.get(id)!);

    // We only process if a custom user label was explicitly added (indicating a correction to a specific label)
    if (addedUserLabels.length === 0) continue;

    // Use the first added user label as correct, and first removed as wrong
    const correct_label = addedUserLabels[0];
    const wrong_label =
      removedUserLabels.length > 0 ? removedUserLabels[0] : undefined;

    try {
      // Fetch the message to get subject & body
      const message = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const headers = message.data.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name?.toLowerCase() === "subject")?.value ??
        "No Subject";

      const fullBody = await getGmailMessageBody(clerkUserId, messageId);
      const bodySnippet = escapeHtml(fullBody?.slice(0, 1000) ?? ""); // Capture large enough snippet for the API
      

      // Fire the correction API

      if (correct_label && wrong_label) {
        await correctLabel({
          user_id: clerkUserId,
          subject,
          body: bodySnippet,
          correct_label,
          wrong_label,
        });

        console.log(
          `[Correction] Processed correction for msg ${messageId}: ${
            wrong_label || "None"
          } -> ${correct_label}`,
        );
      }
    } catch (error) {
      console.error(
        `[Correction] Error processing correction for msg ${messageId}:`,
        error,
      );
    }
  }
}
