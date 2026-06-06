import { WatchedFolder } from "@/app/api/[[...route]]/user";
import { getFolderMap } from "./outlook";
import { db } from "./prisma";
import { bufferEmail, markBufferedEmailRead } from "@/lib/batch-insert";
import { TIER_LIMITS } from "./tiers";

export async function getUserByEmail(email: string) {
  try {
    const data = await db.user_tokens.findUnique({
      where: { email: email },
    });

    if (!data) {
      throw new Error("No email found");
    }

    return data;
  } catch (error) {
    console.error("Error getting clerk id`");
    throw error;
  }
}

export async function getLastHistoryId(email: string) {
  try {
    const data = await db.user_tokens.findUnique({
      where: { email: email },
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
  activated: boolean,
) {
  try {
    const data = await db.user_tokens.update({
      where: { email: email },
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

export async function updateOutlookId(
  email: string | undefined,
  outlookId: string | undefined | null,
  activated: boolean,
) {
  try {
    const data = await db.user_tokens.update({
      where: { email: email },
      data: {
        outlook_id: outlookId,
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

export async function labelColor(label: string, userId: string) {
  try {
    const data = await db.tag.findFirst({
      where: {
        name: label,
        OR: [{ user_id: userId }, { user_id: null }],
      },
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
            description: true,
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

export async function getTaggedEmailCount(user_id: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  return db.email_tracked.count({
    where: {
      user_id,
      tag_id: { not: null },
      created_at: { gte: startOfMonth },
    },
  });
}

export async function addMailtoDB(
  user_id: string,
  tag_id: string | null,
  message_id: string,
  domain: string | null,
  ai_summary?: string,
  ai_action?: string,
) {
  try {
    const user = await db.user_tokens.findUnique({
      where: { clerk_user_id: user_id },
      select: { tier: true },
    });

    if (user?.tier === "FREE") {
      const count = await getTaggedEmailCount(user_id);

      if (count >= TIER_LIMITS.FREE.maxTrackedEmails) {
        return;
      }
    }

    await bufferEmail(user_id, tag_id, message_id, domain, ai_summary, ai_action);
  } catch (error) {
    console.error("Error buffering email to batch");
    throw error;
  }
}

export async function getUserSubscribed(userId: string) {
  try {
    const [data, freeTrial] = await Promise.all([
      db.subscription.findFirst({
        where: { clerkUserId: userId },
        select: {
          cancelAtNextBillingDate: true,
          nextBillingDate: true,
          status: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      db.free_trial.findUnique({
        where: { user_id: userId },
      }),
    ]);

    const hasActiveTrial =
      freeTrial &&
      freeTrial.status === "ACTIVE" &&
      freeTrial.expires_at > new Date();

    if (!data && !hasActiveTrial) {
      return { success: false, subscribed: false };
    }

    // on trial but no paid subscription
    if (!data && hasActiveTrial) {
      return {
        success: true,
        subscribed: true,
        status: "trial",
        next_billing_date: freeTrial.expires_at,
        cancel_at_next_billing_date: null,
        freeTrial: true,
      };
    }

    if (data?.status !== "active" && hasActiveTrial) {
      return {
        success: true,
        subscribed: true,
        status: "trial",
        next_billing_date: freeTrial.expires_at,
        cancel_at_next_billing_date: null,
        freeTrial: true,
      };
    }

    // paid subscription
    return {
      success: true,
      subscribed: data?.status === "active",
      status: data?.status,
      next_billing_date: data?.nextBillingDate,
      cancel_at_next_billing_date: data?.cancelAtNextBillingDate,
      freeTrial: false,
    };
  } catch (error) {
    console.error("Error getting subscribed data");
    throw error;
  }
}

export async function useGetUserDraftPreference(userId: string) {
  try {
    const data = await db.draft_preference.findUnique({
      where: { user_id: userId },
      select: {
        enabled: true,
        draftPrompt: true,
        fontColor: true,
        fontSize: true,
        signature: true,
        timezone: true,
        senstivity: true,
        language: true,
        draft_count: true,
        draft_count_reset_at: true,
      },
    });

    if (!data) {
      return {
        enabled: true,
        draftPrompt: null,
        fontColor: "#000000",
        fontSize: 14,
        signature: null,
        timezone: null,
        senstivity: "",
        language: "english",
        draftCount: 0,
        draftCountResetAt: null as Date | null,
      };
    }

    return {
      enabled: data.enabled,
      draftPrompt: data.draftPrompt,
      fontColor: data.fontColor,
      fontSize: data.fontSize,
      signature: data.signature,
      timezone: data.timezone,
      senstivity: data.senstivity,
      language: data.language,
      draftCount: data.draft_count,
      draftCountResetAt: data.draft_count_reset_at,
    };
  } catch (error) {
    console.error("Error getting draft prefernces ");
    throw error;
  }
}

export async function incrementDraftCount(userId: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const pref = await db.draft_preference.upsert({
    where: { user_id: userId },
    update: {},
    create: {
      user_id: userId,
      draft_count: 0,
      draft_count_reset_at: startOfMonth,
    },
    select: { draft_count: true, draft_count_reset_at: true },
  });

  const needsReset =
    !pref.draft_count_reset_at || new Date(pref.draft_count_reset_at) < startOfMonth;

  const updated = await db.draft_preference.update({
    where: { user_id: userId },
    data: {
      draft_count: needsReset ? 1 : pref.draft_count + 1,
      draft_count_reset_at: startOfMonth,
    },
    select: { draft_count: true },
  });

  return updated.draft_count;
}

export async function getUserIsGmail(userId: string) {
  try {
    const user = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { is_gmail: true },
    });

    if (!user) {
      throw Error;
    }

    return { isGmail: user?.is_gmail };
  } catch (error) {
    console.error("Error getting is user gmail ");
    throw error;
  }
}

export async function updateMessageStatus(
  message_id: string,
  is_read: boolean,
) {
  try {
    const exist = await db.email_tracked.findMany({
      where: { message_id: message_id },
    });

    if (exist.length === 0) {
      await markBufferedEmailRead(message_id, is_read);
      return { updated: false };
    }

    const data = await db.email_tracked.updateMany({
      where: { message_id: message_id },
      data: {
        is_read: is_read,
      },
    });

    if (data.count === 0) {
      return {
        updated: false,
      };
    }

    return {
      updated: true,
    };
  } catch (error) {
    console.error("Error updating read status");
    throw error;
  }
}

export async function activeFolder(userId: string) {
  try {
    const foldersFromOutlook = await getFolderMap(userId);

    const dbResult = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
      select: { watched_folders: true },
    });

    const watchedFolders: WatchedFolder[] = Array.isArray(
      dbResult?.watched_folders,
    )
      ? (dbResult.watched_folders as WatchedFolder[])
      : [];

    const result = Array.from(foldersFromOutlook.entries())
      .filter(([_, node]) => node.name !== "Inbox")
      .map(([id, node]) => ({
        id,
        name: node.name,
        parentPath: node.parentPath,
        isActive: watchedFolders.some((f) => f.id === id),
      }));

    return result;
  } catch (error) {
    console.error("Error getting active folder");
    throw error;
  }
}
