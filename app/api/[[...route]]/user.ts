import { db } from "@/lib/prisma";
import { auth,clerkClient,currentUser} from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()

    .get('/user-token',async(ctx)=>{

        const {userId} = await auth();
        const user = await currentUser();

         if (!userId) {
            return ctx.json({ error: "Unauthorized" }, 401);
        }

        const email = user?.emailAddresses[0].emailAddress;    

        const data = await db.user_tokens.findUnique({
            where:{gmail_email:email}
        })

        if(!data){
            return ctx.json({error:"Error getting user-token"},500);
        }

        return ctx.json({data},200);
    })

    .post('/store-token',async(ctx)=>{

        const {userId} = await auth();
        const user = await currentUser();
        const client = await clerkClient();

         if (!userId) {
            return ctx.json({ error: "Unauthorized" }, 401);
        }

        const email = user?.emailAddresses[0].emailAddress;

        const tokenResponse = await client.users.getUserOauthAccessToken(
            userId,
            'google'
        );

        const accessToken = tokenResponse.data[0]?.token;

        if(!accessToken || !email){
            return ctx.json({error:"Missing data"},400);
        }

        const data = await db.user_tokens.upsert({

            where:{clerk_user_id:userId},
            update:{
                gmail_email:email,
                access_token:accessToken,
                updated_at:new Date()
            },
            create:{
                clerk_user_id:userId,
                gmail_email:email,
                access_token:accessToken,
                updated_at:new Date()
            }
            
        })

        if(!data){
            return ctx.json({error:"Error getting or creating data"},500)
        }

        return ctx.json({data},200);

    })

export default app;