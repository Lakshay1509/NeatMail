import { classifyEmail } from "@/lib/openai";
import { getUserToken } from "@/lib/supabase";
import { google } from "googleapis";
import { Hono } from "hono";

const app = new Hono().post("/", async (ctx) => {
  const body = await ctx.req.json();
  const message = body.message;

  if (!message?.data) {
    return ctx.json({ success: true }, 200);
  }


  const decodedData = Buffer.from(message.data, "base64").toString();

  const notification = JSON.parse(decodedData);

  const { emailAddress, historyId } = notification;

  const tokenData = await getUserToken(emailAddress);

  if (!tokenData) {
    return ctx.json({ success: true }, 200);
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokenData.access_token });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

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

    for(const msg of messages){
        const messageId = msg.message?.id;
        if(!messageId) continue;

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

      const labelName = await classifyEmail(emailData);

      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      let labelId = labelsResponse.data.labels?.find(l => l.name === labelName)?.id;
      
      if (!labelId) {
        const newLabel = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: labelName,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        });
        labelId = newLabel.data.id!;
      }
      
      // Apply label
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [labelId],
        },
      });

    }

  return ctx.json({ success: true }, 200);
});

export default app;
