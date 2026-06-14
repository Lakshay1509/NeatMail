import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let user = await currentUser();

  if (!user) {
    await new Promise((r) => setTimeout(r, 500));
    user = await currentUser();
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? `${userId}@pending.neatmail`;

  await db.user_tokens.upsert({
    where: { clerk_user_id: userId },
    update: { email },
    create: {
      clerk_user_id: userId,
      email,
    },
  });

  return Response.json({ ok: true });
}
