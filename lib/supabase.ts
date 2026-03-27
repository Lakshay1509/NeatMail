import { encryptDomain } from "./encode";
import { db } from "./prisma";

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
        outlook_id:outlookId,
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
            description:true
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

export async function getModelTagsUser(id: string) {
  try {
    const defaultTags = await db.tag.findMany({
      where: { user_id: null },
      select: { name: true, description: true }
    });

    const userTags = await db.user_tags.findMany({
      where: { user_id: id },
      include: { tag: { select: { name: true, description: true } } }
    });

    const combined = [...defaultTags, ...userTags.map(ut => ut.tag)];
    
    // remove duplicates by name
    const uniqueTags = Array.from(new Map(combined.map(item => [item.name, item])).values());
    
    return uniqueTags;
  } catch(error) {
    console.error("Error getting possible model tags", error);
    throw error;
  }
}

export async function addMailtoDB(
  user_id: string,
  tag_id: string,
  message_id: string,
  domain: string | null,
) {
  try {
    const normalizedDomain = domain?.trim()
    const encryptedDomain = normalizedDomain
      ? await encryptDomain(normalizedDomain)
      : null;

    const data = await db.email_tracked.upsert({
      where: { message_id: message_id },
      update: {
        message_id: message_id,
        ...(encryptedDomain ? { domain: encryptedDomain } : {}),
        
      },
      create: {
        user_id: user_id,
        tag_id: tag_id,
        message_id: message_id,
        domain: encryptedDomain,
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

export async function getUserSubscribed(userId: string) {
  try {
    const data = await db.subscription.findFirst({
      where: { clerkUserId: userId },
      select: {
        cancelAtNextBillingDate: true,
        nextBillingDate: true,
        status: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!data) {
      return {
        success: false,
        subscribed: false,
      };
    }

    return {
      success: true,
      subscribed: data.status === "active" ? true : false,
      status: data.status,
      next_billing_date: data.nextBillingDate,
      cancel_at_next_billing_date: data.cancelAtNextBillingDate,
    };
  } catch (error) {
    console.error("Erro getting subscribed data");
    throw error;
  }
}

export async function useGetUserDraftPreference(userId: string) {
  try {
    const data = await db.draft_preference.findUnique({
      where: { user_id: userId },
      select: {
        enabled:true,
        draftPrompt: true,
        fontColor: true,
        fontSize: true,
        signature: true,
        timezone:true,
        senstivity:true
      },
    });

    if (!data) {
      return {
        enabled:true,
        draftPrompt: null,
        fontColor: "#000000",
        fontSize: 14,
        signature: null,
        timezone:null,
        senstivity:""
      };
    }

    return {
      enabled:data.enabled,
      draftPrompt: data.draftPrompt,
      fontColor: data.fontColor,
      fontSize: data.fontSize,
      signature: data.signature,
      timezone:data.timezone,
      senstivity:data.senstivity
    };
  } catch (error) {
    console.error("Error getting draft prefernces ");
    throw error;
  }
}

export async function getUserIsGmail(userId:string){
  try{
     const user = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { is_gmail: true },
      });

      if(!user){
        throw Error
      }

      return {isGmail:user?.is_gmail}

  }
  catch (error) {
    console.error("Error getting is user gmail ");
    throw error;
  }
}


export async function updateMessageStatus(message_id:string,is_read:boolean){

  try{

    const exist = await db.email_tracked.findMany({
      where:{message_id:message_id}
    })

    if(exist.length===0){
      return {updated:false}
    }
   

    const data = await db.email_tracked.updateMany({
      where:{message_id:message_id},
      data:{
        is_read:is_read
      }
    })

    if(data.count === 0){
      return {
        updated: false,
      };
    }

    return {
      updated: true,
    };

  }catch(error){
      console.error("Error updating read status");
      throw error;
    }
}