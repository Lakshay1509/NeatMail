import { inngest } from "@/lib/inngest";
import { addUserLabel } from "@/lib/model";
import { db } from "@/lib/prisma";

export const addUserLabelFn = inngest.createFunction(
  {
    id: "add-user-label",
    retries: 1,
    // Optional: alert after all retries fail
    onFailure: async ({ event, error }) => {
      // Rollback: delete the tag from DB if label creation permanently fails
      const {user_id,tag_id} = event.data.event.data;
      await db.user_tags.deleteMany({ where: { tag_id, user_id } });
      await db.tag.delete({ where: { id: tag_id } });
      console.error(`Failed to add label for tag ${tag_id}:`, error);
    },
  },
  { event: "tag/label.add" },
  async ({ event }) => {
    const { user_id, label_name, description} = event.data;

    await addUserLabel({ user_id, label_name, description });

    return { success: true };
  },
);