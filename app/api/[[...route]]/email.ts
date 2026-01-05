import { applyLabelsToEmails, getRecentEmails } from "@/lib/gmail";
import { classifyEmail } from "@/lib/openai";
import { auth } from "@clerk/nextjs/server";
import { Hono } from "hono";

const app = new Hono()

  .get("/fetch", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const emails = await getRecentEmails(userId, 15);

    return ctx.json({ emails }, 200);
  })

  .get("/classify-email", async (ctx) => {
    const { userId } = await auth();

    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const emails = await getRecentEmails(userId, 15);

    // const classifiedEmails: {
    //   id: string;
    //   threadId: string;
    //   subject: string;
    //   from: string;
    //   to: string;
    //   snippet: string | null | undefined;
    //   labels: string[];
    //   isRead: boolean;
    //   date: Date;
    //   rawDateHeader: string;
    //   label: string;
    // }[] = await Promise.all(
    //   emails.map(async (email) => {
    //     const classification = await classifyEmail({
    //       subject: email.subject,
    //       from: email.from,
    //       bodySnippet: email.snippet ?? "", 
    //     });
    //     return { ...email, label: classification};
    //   })
    // );


    // const emailsByLabel = classifiedEmails.reduce((acc, email) => {
    //   if (!acc[email.label]) acc[email.label] = [];
    //   acc[email.label].push(email.id);
    //   return acc;
    // }, {} as Record<string, string[]>);
    
    // for (const [labelName, messageIds] of Object.entries(emailsByLabel)) {
    //   await applyLabelsToEmails(userId, messageIds, labelName);
    // }

    // return ctx.json({ emails: classifiedEmails }, 200);
    
  });

export default app;
