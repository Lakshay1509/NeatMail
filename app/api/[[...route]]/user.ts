import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()
  .get("/watch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.user_tokens.findUnique({
      where: { clerk_user_id: userId },
    });

    if (!data) {
      return ctx.json({ error: "Error getting watch data" }, 500);
    }

    return ctx.json({ data }, 200);
  })

  .get("/mailsThisMonth", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const now = new Date();

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const data = await db.email_tracked.count({
      where: {
        user_id: userId,
        created_at: {
          gte: startOfMonth,
          lt: startOfNextMonth,
        },
      },
    });


    return ctx.json({data},200)
  })

  .get('/drafts',async(ctx)=>{

    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.drafts.findMany({
      where:{user_id:userId},
      orderBy:{
        created_at:'desc'
      }
    })

    if(!data){
      return ctx.json({error:"Error getting draft data"},500);
    }

    return ctx.json({data},200);

  })

  .get('/subscription',async(ctx)=>{

    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const data = await db.subscription.findFirst({
      where:{clerkUserId:userId,
        status:'active'
      }
    })

    if(!data){
      return ctx.json({
        success:false,
        subscribed:false
      },200);
    }

    return ctx.json({
      success:true,
      subscribed:true
    },200)

  })

export default app;
