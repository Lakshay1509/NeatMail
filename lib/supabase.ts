import { db } from "./prisma";

export async function getUserByEmail(email: string) {
  try {
    const data = await db.user_tokens.findUnique({
      where: { gmail_email: email },
    });

    if (!data) {
      throw new Error("No email found");
    }

    return data;
  } catch (error) {
    console.error("Error getting clerk id");
    throw error;
  }
}

export async function getLastHistoryId(email: string) {
  try {
    const data = await db.user_tokens.findUnique({
      where: { gmail_email: email },
    });

    if (!data) {
      throw new Error(`No user token found for email: ${email}`);
    }

    return data;
  } catch (error) {
    console.error(`Error getting history ID for ${email}:`, error);
    throw error;
  }
}

export async function updateHistoryId(
  email: string | undefined,
  historyId: string | undefined | null,
  activated: boolean
) {
  try {
    const data = await db.user_tokens.update({
      where: { gmail_email: email },
      data: {
        last_history_id: historyId,
        watch_activated: activated,
        updated_at: new Date().toISOString(),
      },
    });

    if (!data) {
      throw new Error(`No user token found for email: ${email}`);
    }

    return data;
  } catch (error) {
    console.error(`Error updating history ID for ${email}:`, error);
    throw error;
  }
}

export async function labelColor(label: string) {
  try {
    const data = await db.tag.findUnique({
      where: { name: label },
    });

    if (!data) {
      throw new Error(`No color for this : ${label}`);
    }

    return data;
  } catch (error) {
    console.error(`Error getting tag`, error);
    throw error;
  }
}

export async function getTagsUser(id: string) {
  try {
    const data = await db.user_tags.findMany({
      where: {
        user_id: id,
      },
      include: {
        tag: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!data) {
      throw new Error(`No label for this : ${id}`);
    }

    return data;
  } catch (error) {
    console.error(`Error getting tags for this id`);
    throw error;
  }
}

export async function addMailtoDB(
  user_id: string,
  tag_id: string,
  message_id: string
) {
  try {
    const data = await db.email_tracked.upsert({
      where: { message_id: message_id },
      update: {
        message_id: message_id,
      },
      create: {
        user_id: user_id,
        tag_id: tag_id,
        message_id: message_id,
        created_at: new Date().toISOString(),
      },
    });

    if (!data) {
      throw new Error(`Failed to add to DB`);
    }
  } catch (error) {
    console.error("Error adding to db");
    throw error;
  }
}

export async function addDraftToDB(
  user_id: string,
  message_id: string,
  draft: string,
  recipent:string
) {
  try {
    const data = await db.drafts.upsert({
      where: {
        user_id_message_id: {
          user_id,
          message_id,
        },
      },

      update: {
        draft: draft,
      },
      create: {
        user_id: user_id,
        message_id: message_id,
        draft: draft,
        receipent:recipent,
        created_at: new Date().toISOString(),
      },
    });

    if (!data) {
      throw new Error(`Failed to create draft in db`);
    }
  } catch (error) {
    console.error("Error adding draft to db");
    throw error;
  }
}
