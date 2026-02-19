import { createGmailDraft } from "@/lib/gmail";
import { classifyEmail as classifyEmailOpenAI, generateEmailReply } from "@/lib/openai";
import { classifyEmail as classifyEmailModel } from "@/lib/model";
import {
  isMessageProcessed,
  isThreadProcessed,
  markMessageProcessed,
  markThreadProcessed,
} from "@/lib/redis";
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
import { OAuth2Client } from "google-auth-library";

const authClient = new OAuth2Client();

// Test users for the new classification model
const MODEL_TEST_USERS:string[] = [

  "user_38NbAtb7Fk5Vmm0QIdSs5l0bMV5",
  "user_38OIS4VC2YhAJZJlJ0vzkY0dBFm",
  "user_38OV7Wute3LN46bJMD3TL2CuthV",
  "user_38VwbHZlwUy4Bn7mJXYYwhHFaKq"
  
];

const app = new Hono().post("/", async (ctx) => {
  try {
    const authHeader = ctx.req.header("Authorization");

    if (!authHeader) {
      return ctx.json({ error: "Error missing authorization header" }, 401);
    }

    const token = authHeader.split(" ")[1];

    const ticket = await authClient.verifyIdToken({
      idToken: token,
      audience: "https://dashboard.neatmail.app/api/gmail-webhook",
    });

    const payload = ticket.getPayload();

    if (payload?.email !== process.env.GMAIL_SERVICE_ACCOUNT) {
      return ctx.json({ error: "Invalid service account" }, 401);
    }

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

    const subscribed = await getUserSubscribed(user.clerk_user_id);

    if (subscribed.subscribed === false) {
      return ctx.json({ error: "user not subscribed" }, 200);
    }

    const clerkUserId = user.clerk_user_id;

    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google",
    );

    const tokenData = tokenResponse.data[0]?.token;

    if (!tokenData) {
      console.log("No token found for user");
      return ctx.json({ success: true }, 200);
    }

    const lastHistoryId = await getLastHistoryId(emailAddress);

    if (!lastHistoryId || !lastHistoryId.last_history_id) {
      await updateHistoryId(emailAddress, newHistoryId, true);
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
            m.message?.labelIds?.includes("INBOX"),
          ) || [],
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

      // if thread as processed for 24 hours to prevent duplication tags
      if (await isThreadProcessed(String(emailData.threadId))) {
        continue;
      }

      const tagsOfUser = await getTagsUser(clerkUserId);

      // Check if Gmail already classified this as Promotions
      let labelName: string;
      const hasMarketingTag = tagsOfUser.some(
        (tag: any) => tag.tag.name === "Marketing"
      );
      
      if (email.data.labelIds?.includes("CATEGORY_PROMOTIONS") && hasMarketingTag) {
        labelName = "Marketing";
      } else {
        // Use model API for test users, OpenAI for others
        const useModelAPI = MODEL_TEST_USERS.includes(clerkUserId);
        
        if (useModelAPI) {
          const modelResult = await classifyEmailModel({
            user_id: clerkUserId,
            subject: emailData.subject,
            sender: emailData.from,
            body: emailData.bodySnippet,
            labels: tagsOfUser.map((tag: any) => tag.tag.name),
          });
          labelName = modelResult.label;
        } else {
          labelName = await classifyEmailOpenAI(emailData, tagsOfUser);
        }
      }

      if (labelName === "") {
        console.log(`No label assigned for message: ${messageId}`);
        continue;
      }

      const colourofLabel = await labelColor(labelName, clerkUserId);

      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      let labelId = labelsResponse.data.labels?.find(
        (l) => l.name === labelName,
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

      let draftBody: string = "";

      if (labelName === "Pending Response") {
        draftBody = await generateEmailReply(emailData);

        if (draftBody.trim().length > 0) {
          await createGmailDraft(
            clerkUserId,
            emailData.threadId!,
            messageId,
            emailData.subject,
            emailData.from,
            draftBody,
          );
        }
      }

      await markThreadProcessed(String(emailData.threadId));

      await addMailtoDB(clerkUserId, colourofLabel.id, String(messageId));

      if (draftBody.trim().length > 0) {
        addDraftToDB(clerkUserId, String(messageId), draftBody, emailData.from);
      }
    }

    await updateHistoryId(emailAddress, String(newHistoryId), true);

    return ctx.json({ success: true }, 200);
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    // Return 200 to prevent Pub/Sub retries
    return ctx.json(
      { success: true, error: "Processing failed but acknowledged" },
      200,
    );
  }
});

export default app;
