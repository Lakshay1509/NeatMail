import { createGmailDraft } from "@/lib/gmail";
import { classifyEmail, generateEmailReply } from "@/lib/openai";
import { isMessageProcessed, markMessageProcessed } from "@/lib/redis";
import { getLastHistoryId, getUserByEmail, updateHistoryId } from "@/lib/supabase";
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

    if(!user){
      console.log('No user found');
      return ctx.json({success:true},200);
    }

    const clerkUserId = user.clerk_user_id;

    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
    clerkUserId,
    'google'
  );
  
  const tokenData = tokenResponse.data[0]?.token;

    if (!tokenData) {
      console.log("No token found for user");
      return ctx.json({ success: true }, 200);
    }
    console.log("✅ Token retrieved");

    const lastHistoryId = await getLastHistoryId(emailAddress);
    
    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      console.log("No previous historyId found, storing current one");
      await updateHistoryId(emailAddress, newHistoryId);
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

    console.log(`📬 Found ${messages.length} new messages`);

    for (const msg of messages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      if (await isMessageProcessed(messageId)) {
    console.log(`⏭️ Skipping duplicate: ${messageId}`);
    continue;
  }

      console.log(`\n📨 Processing message: ${messageId}`);

      const email = await gmail.users.messages.get({
        userId: 'me',
        id: messageId
      });

      const emailData = {
        id: email.data.id,
        threadId : email.data.threadId,
        subject: email.data.payload?.headers?.find(h => h.name === 'Subject')?.value || '',
        from: email.data.payload?.headers?.find(h => h.name === 'From')?.value || '',
        bodySnippet: email.data.snippet || '',
      };

      console.log(`Subject: ${emailData.subject}`);
      console.log(`From: ${emailData.from}`);

      console.log("🤖 Classifying email...");
      const labelName = await classifyEmail(emailData);
      console.log(`🏷️ Classified as: ${labelName}`);

      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      let labelId = labelsResponse.data.labels?.find(l => l.name === labelName)?.id;
      
      if (!labelId) {
        console.log(`Creating new label: ${labelName}`);
        const newLabel = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: labelName,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        });
        labelId = newLabel.data.id!;
        console.log(`✅ Label created with ID: ${labelId}`);
      } else {
        console.log(`Label already exists with ID: ${labelId}`);
      }
      
      // Apply label
      console.log("Applying label to message...");
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [labelId],
        },
      });
      console.log("✅ Label applied successfully");

      if (labelName === 'Pending Response') {
        console.log("🤖 Generating draft response...");
        
        const draftBody = await generateEmailReply(emailData);
        console.log(`✍️ Draft generated: ${draftBody.substring(0, 100)}...`);
        
        const draft = await createGmailDraft(
          gmail,
          emailData.threadId!,
          messageId,
          emailData.subject,
          emailData.from,
          draftBody
        );
        
        console.log(`✅ Draft created! ID: ${draft.id}`);
      }
      await markMessageProcessed(messageId);
    }

    await updateHistoryId(emailAddress, String(newHistoryId));
    console.log(`✅ Updated historyId to: ${newHistoryId}`);

    console.log("\n✨ Webhook processing complete");
    return ctx.json({ success: true }, 200);
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    // Return 200 to prevent Pub/Sub retries
    return ctx.json({ success: true, error: "Processing failed but acknowledged" }, 200);
  }
});

export default app;
