"use server";

import { db } from "@/lib/prisma";
import { auth, clerkClient } from "@clerk/nextjs/server";

export async function deleteUnauthorizedUser() {
  const { userId } = await auth();
  
  if (!userId) return { success: false };

  try {
    const client = await clerkClient();
    await db.user_tokens.delete({where:{clerk_user_id:userId}})
    await client.users.deleteUser(userId);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete user:", error);
    return { success: false };
  }
}
