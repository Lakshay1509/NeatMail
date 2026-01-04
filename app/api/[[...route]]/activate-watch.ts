import { auth, clerkClient } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { Hono } from "hono";

const app = new Hono().post("/", async (ctx) => {
  const { userId } = await auth();

  if (!userId) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  const client = await clerkClient();

  const tokenResponse = await client.users.getUserOauthAccessToken(
    userId,
    "google"
  );

  const accessToken = tokenResponse.data[0]?.token;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const watchRequest = {
    labelIds: ["INBOX"],
    topicName: 'projects/mail-service-483207/topics/gmail-push-notifications',
  };

  const response = await gmail.users.watch({
    userId: "me",
    requestBody: watchRequest,
  });

  if (!response) {
    return ctx.json({ error: "Error setting up watch" }, 500);
  }

  return ctx.json(
    { success: true, expiresIn: "7 days", historyId: response.data.historyId },
    200
  );
});

export default app;
