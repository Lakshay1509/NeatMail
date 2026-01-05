import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()

    .get('/',async(ctx)=>{
        
        const { userId } = await auth();
        const user = await currentUser();

        if(!userId){
            return ctx.json({error:'Unuathorized'},401);
        }

        const data = await db.user_tags.findMany({
            where:{user_id:user?.id}
        })

        return ctx.json({data},200);
    })

export default app