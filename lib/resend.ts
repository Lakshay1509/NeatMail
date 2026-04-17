import { Resend } from "resend";
import { db } from "./prisma";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendSubExpiredEmail(userEmail:string, userName:string){

    try{
        const now = new Date();
        const startOfPeriod = new Date(now);
          startOfPeriod.setDate(startOfPeriod.getDate() - 30);

          const endOfPeriod = new Date(now);
        const data = await db.email_tracked.count({
                    where: {
                      user_tokens:{
                        email:userEmail
                      },
                      created_at: {
                        gte: startOfPeriod,
                        lt: endOfPeriod,
                      },
                    },
                  });
         await resend.emails.send({
            to: userEmail,
            template: {
              id: "subscription-ended-reminder",
              variables: {
                firstName: userName ?? "User",
                last30DaysCount: String(data),
                renewalLink: "https://dashboard.neatmail.app/billing",
              },
            },
          });
    }catch(_error){
        console.error('Error sending reminder to user')    //Don't throw new Error to prevent webhook retry

    }
} 

