import { db } from "./prisma";

export async function getUserToken(email: string) {
  const data = await db.user_tokens.findUnique({
    where: { gmail_email: email },
  });

  if (!data) {
    throw new Error(`No user token found for email: ${email}`);
  }

  return data;
}

export async function getLastHistoryId(email:string){

  const data = await db.user_tokens.findUnique({
    where:{gmail_email:email}
  })

  if (!data) {
    throw new Error(`No user token found for email: ${email}`);
  }

  return data;

}

export async function updateHistoryId(email:string|undefined,historyId:string|undefined|null){

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


}

