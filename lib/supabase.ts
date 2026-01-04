import { db } from "./prisma";

export async function getUserByEmail(email:string){

  try{
    const data = await db.user_tokens.findUnique({
      where:{gmail_email:email}
    })

    if(!data){
      throw new Error('No email found');
    }

    return data;
  }
  catch(error){
    console.error('Error getting clerk id');
    throw error;
  }
}

export async function getLastHistoryId(email:string){
  try {
    const data = await db.user_tokens.findUnique({
      where:{gmail_email:email}
    })

    if (!data) {
      throw new Error(`No user token found for email: ${email}`);
    }

    return data;
  } catch (error) {
    console.error(`Error getting history ID for ${email}:`, error);
    throw error;
  }
}

export async function updateHistoryId(email:string|undefined,historyId:string|undefined|null){
  try {
    const data = await db.user_tokens.update({
      where:{gmail_email:email},
      data:{
        last_history_id:historyId
      }
    })

    if (!data) {
      throw new Error(`No user token found for email: ${email}`);
    }

    return data;
  } catch (error) {
    console.error(`Error updating history ID for ${email}:`, error);
    throw error;
  }
}

