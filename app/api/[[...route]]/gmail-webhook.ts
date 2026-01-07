import { createGmailDraft } from "@/lib/gmail";
import { classifyEmail, generateEmailReply } from "@/lib/openai";
import { isMessageProcessed, markMessageProcessed } from "@/lib/redis";
import {
  addMailtoDB,
  getLastHistoryId,
  getTagsUser,
  getUserByEmail,
  labelColor,
  updateHistoryId,
} from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";


const app = new Hono().post("/", async (ctx) => {
  try {
    const body = await ctx.req.json();
    const message = body.message;

    if (!message?.data) {
      return ctx.json({ success: true }, 200);
    }

    const decodedData = Buffer.from(message.data, "base64").toString();

    const notification = JSON.parse(decodedData);

    const { emailAddress, historyId: newHistoryId } = notification;

    const user = await getUserByEmail(emailAddress);

    if (!user) {
      console.log("No user found");
      return ctx.json({ success: true }, 200);
    }

    const clerkUserId = user.clerk_user_id;

    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google"
    );

    const tokenData = tokenResponse.data[0]?.token;

    if (!tokenData) {
      console.log("No token found for user");
      return ctx.json({ success: true }, 200);
    }
    
    const lastHistoryId = await getLastHistoryId(emailAddress);

    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      
      await updateHistoryId(emailAddress, newHistoryId,true);
      return ctx.json({ success: true }, 200);
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: tokenData });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId.last_history_id,
      historyTypes: ["messageAdded"],
    });

    const messages =
      history.data.history?.flatMap(
        (h) =>
          h.messagesAdded?.filter((m) =>
            m.message?.labelIds?.includes("INBOX")
          ) || []
      ) || [];

    

    for (const msg of messages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      if (await isMessageProcessed(messageId)) {
        
        continue;
      }

      // Mark as processed immediately to prevent race conditions
      await markMessageProcessed(messageId);

      const email = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
      });

      const emailData = {
        id: email.data.id,
        threadId: email.data.threadId,
        subject:
          email.data.payload?.headers?.find((h) => h.name === "Subject")
            ?.value || "",
        from:
          email.data.payload?.headers?.find((h) => h.name === "From")?.value ||
          "",
        bodySnippet: email.data.snippet || "",
      };

      const tagsOfUser = await getTagsUser(clerkUserId);
     
      const labelName = await classifyEmail(emailData,tagsOfUser);

       if(labelName===''){
        console.log(`No label assigned for message: ${messageId}`);
        continue;
      }

      const colourofLabel = await labelColor(labelName);
    
      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      let labelId = labelsResponse.data.labels?.find(
        (l) => l.name === labelName
      )?.id;

      if (!labelId) {
        console.log(`Creating new label: ${labelName}`);
        const newLabel = await gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
            color: {
              textColor: "#ffffff", 
              backgroundColor: colourofLabel.color, 
            },
          },
        });
        labelId = newLabel.data.id!;
        
      } 

      // Apply label
      
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds: [labelId],
        },
      });

      
      if (labelName === "Pending Response") {
       

        const draftBody = await generateEmailReply(emailData);
        

        await createGmailDraft(
          clerkUserId,
          emailData.threadId!,
          messageId,
          emailData.subject,
          emailData.from,
          draftBody
        );

        
      }

      await addMailtoDB(clerkUserId,colourofLabel.id,String(messageId),);


    }

    await updateHistoryId(emailAddress, String(newHistoryId),true);
    
   
    return ctx.json({ success: true }, 200);
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    // Return 200 to prevent Pub/Sub retries
    return ctx.json(
      { success: true, error: "Processing failed but acknowledged" },
      200
    );
  }
});

export default app;
