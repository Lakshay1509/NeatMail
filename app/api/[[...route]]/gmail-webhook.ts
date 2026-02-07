import { createGmailDraft } from "@/lib/gmail";
import { classifyEmail, generateEmailReply } from "@/lib/openai";
import { isMessageProcessed, isThreadProcessed, markMessageProcessed, markThreadProcessed } from "@/lib/redis";
import {
  addDraftToDB,
  addMailtoDB,
  getLastHistoryId,
  getTagsUser,
  getUserByEmail,
  getUserSubscribed,
  labelColor,
  updateHistoryId,
} from "@/lib/supabase";
import { clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";
import { OAuth2Client } from 'google-auth-library';


const authClient = new OAuth2Client();


const app = new Hono().post("/", async (ctx) => {
  try {
    console.log("[Webhook] Received webhook request");

    const authHeader = ctx.req.header('Authorization');

    if(!authHeader){
      console.log("[Webhook] Authorization header missing");
      return ctx.json({error:'Error missing authorization header'},401);
    }

    const token = authHeader.split(' ')[1];
    console.log("[Webhook] Verifying ID token");

    const ticket = await authClient.verifyIdToken({
      idToken:token,
      audience: 'https://dashboard.neatmail.tech/api/gmail-webhook'
    })

    const payload = ticket.getPayload();

    if(payload?.email!==process.env.GMAIL_SERVICE_ACCOUNT){
      console.log("[Webhook] Invalid service account:", payload?.email);
      return ctx.json({error:'Invalid service account'},401);
    }

    console.log("[Webhook] Service account verified successfully");

    const body = await ctx.req.json();
    const message = body.message;

    if (!message?.data) {
      console.log("[Webhook] No message data in request body");
      return ctx.json({ success: true }, 200);
    }

    const decodedData = Buffer.from(message.data, "base64").toString();

    const notification = JSON.parse(decodedData);
    console.log("[Webhook] Notification received for:", notification.emailAddress, "historyId:", notification.historyId);

    const { emailAddress, historyId: newHistoryId } = notification;

    const user = await getUserByEmail(emailAddress);
    

    if (!user) {
      console.log("[Webhook] No user found for email:", emailAddress);
      return ctx.json({ success: true }, 200);
    }

    console.log("[Webhook] User found:", user.clerk_user_id);

    const subscribed = await getUserSubscribed(user.clerk_user_id);

    if(subscribed.subscribed===false){
      console.log("[Webhook] User not subscribed:", user.clerk_user_id);
      return ctx.json({error:"user not subscribed"},200);
    }

    console.log("[Webhook] User subscription verified");

    const clerkUserId = user.clerk_user_id;

    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google"
    );

    const tokenData = tokenResponse.data[0]?.token;

    if (!tokenData) {
      console.log("[Webhook] No OAuth token found for user:", clerkUserId);
      return ctx.json({ success: true }, 200);
    }
    
    console.log("[Webhook] OAuth token retrieved successfully");

    const lastHistoryId = await getLastHistoryId(emailAddress);

    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      console.log("[Webhook] No previous history ID found, initializing with:", newHistoryId);
      await updateHistoryId(emailAddress, newHistoryId,true);
      return ctx.json({ success: true }, 200);
    }

    console.log("[Webhook] Fetching history from:", lastHistoryId.last_history_id, "to:", newHistoryId);

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

    console.log("[Webhook] Found", messages.length, "new messages in INBOX");

    for (const msg of messages) {
      const messageId = msg.message?.id;
      if (!messageId) continue;

      console.log("[Webhook] Processing message:", messageId);

      if (await isMessageProcessed(messageId)) {
        console.log("[Webhook] Message already processed, skipping:", messageId);
        continue;
      }

      // Mark as processed immediately to prevent race conditions
      await markMessageProcessed(messageId);
      console.log("[Webhook] Marked message as processed:", messageId);

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

      console.log("[Webhook] Email data:", {
        id: emailData.id,
        threadId: emailData.threadId,
        subject: emailData.subject,
        from: emailData.from
      });

      // if thread as processed for 24 hours to prevent duplication tags
      if(await isThreadProcessed(String(emailData.threadId))){
        console.log("[Webhook] Thread already processed, skipping:", emailData.threadId);
        continue;
      }

      const tagsOfUser = await getTagsUser(clerkUserId);
      console.log("[Webhook] Retrieved user tags, count:", tagsOfUser.length);
     
      const labelName = await classifyEmail(emailData,tagsOfUser);
      console.log("[Webhook] Email classified as:", labelName);

       if(labelName===''){
        console.log("[Webhook] No label assigned for message:", messageId);
        continue;
      }

      const colourofLabel = await labelColor(labelName,clerkUserId);
      console.log("[Webhook] Label color retrieved:", colourofLabel.color);
    
      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      let labelId = labelsResponse.data.labels?.find(
        (l) => l.name === labelName
      )?.id;

      if (!labelId) {
        console.log("[Webhook] Creating new label:", labelName);
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
        console.log("[Webhook] New label created with ID:", labelId);
      } else {
        console.log("[Webhook] Using existing label ID:", labelId);
      }

      // Apply label
      
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds: [labelId],
        },
      });

      console.log("[Webhook] Label applied to message:", messageId);

      let draftBody:string=""

      
      if (labelName === "Pending Response") {
        console.log("[Webhook] Generating reply for Pending Response message:", messageId);

        draftBody = await generateEmailReply(emailData);
        console.log("[Webhook] Reply generated, length:", draftBody.length);

        await createGmailDraft(
          clerkUserId,
          emailData.threadId!,
          messageId,
          emailData.subject,
          emailData.from,
          draftBody
        );

        console.log("[Webhook] Draft created for message:", messageId);
      }

      await markThreadProcessed(String(emailData.threadId));
      console.log("[Webhook] Thread marked as processed:", emailData.threadId);

      await addMailtoDB(clerkUserId,colourofLabel.id,String(messageId));
      console.log("[Webhook] Mail added to database");

      if(draftBody.trim().length > 0){
        addDraftToDB(clerkUserId,String(messageId),draftBody,emailData.from);
        console.log("[Webhook] Draft added to database");
      }

    }

    await updateHistoryId(emailAddress, String(newHistoryId),true);
    console.log("[Webhook] History ID updated to:", newHistoryId);
   
    console.log("[Webhook] Processing completed successfully");
    return ctx.json({ success: true }, 200);
  } catch (error) {
    console.error("[Webhook] Error processing webhook:", error);
    console.error("[Webhook] Error stack:", error instanceof Error ? error.stack : 'No stack trace available');
    // Return 200 to prevent Pub/Sub retries
    return ctx.json(
      { success: true, error: "Processing failed but acknowledged" },
      200
    );
  }
});

export default app;
