import { classifyEmail } from "@/lib/openai";
import { getUserToken } from "@/lib/supabase";
import { google } from "googleapis";
import { Hono } from "hono";

const app = new Hono().post("/", async (ctx) => {
  console.log("📨 Webhook received");
  const body = await ctx.req.json();
  console.log("Body:", JSON.stringify(body, null, 2));
  const message = body.message;

  if (!message?.data) {
    console.log("⚠️ No message data, skipping");
    return ctx.json({ success: true }, 200);
  }

  const decodedData = Buffer.from(message.data, "base64").toString();
  console.log("Decoded data:", decodedData);

  const notification = JSON.parse(decodedData);
  console.log("Notification:", notification);

  const { emailAddress, historyId } = notification;
  console.log(`📧 Email: ${emailAddress}, History ID: ${historyId}`);

  const tokenData = await getUserToken(emailAddress);

  if (!tokenData) {
    console.log("❌ No token found for user");
    return ctx.json({ success: true }, 200);
  }
  console.log("✅ Token retrieved");

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokenData.access_token });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  console.log("🔍 Fetching history...");
  const history = await gmail.users.history.list({
    userId: "me",
    startHistoryId: historyId,
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

  for(const msg of messages){
    const messageId = msg.message?.id;
    if(!messageId) continue;

    console.log(`\n📨 Processing message: ${messageId}`);

    const email = await gmail.users.messages.get({
      userId:'me',
      id:messageId
    });

    const emailData = {
      id: email.data.id,
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
  }

  console.log("\n✨ Webhook processing complete");
  return ctx.json({ success: true }, 200);
});

export default app;
