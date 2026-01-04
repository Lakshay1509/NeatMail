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
