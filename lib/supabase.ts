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

export async function updateHistoryId(email:string|undefined,historyId:string|undefined|null,activated:boolean){
  try {
    
    const data = await db.user_tokens.update({
      where:{gmail_email:email},
      data:{
        last_history_id:historyId,
        watch_activated:activated,
        updated_at: new Date().toISOString()

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

export async function labelColor(label:string) {

  try{
    const data = await db.tag.findUnique({
      where:{name:label}
    })

    if (!data) {
      throw new Error(`No color for this : ${label}`);
    }

    return data;


  } catch(error){
    console.error(`Error getting tag`,error);
    throw error;
  }
  
}

export async function getTagsUser(id:string){
  try{
    const data = await db.user_tags.findMany({
      where:{
        user_id:id
      },
      include:{
        tag:{
          select:{
            name:true
          }
        }
      }
    })

    if (!data) {
      throw new Error(`No label for this : ${id}`);
    }

    return data;

  }catch(error){
    console.error(`Error getting tags for this id`);
    throw error
  }
}