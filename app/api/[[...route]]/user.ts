import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono().get("/watch", async (ctx) => {
  const { userId } = await auth();

  if (!userId) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  const data = await db.user_tokens.findUnique({
    where:{clerk_user_id:userId}
  })

  if(!data){
    return ctx.json({error:"Error getting watch data"},500);
  }

  return ctx.json({data},200)
});

export default app;
