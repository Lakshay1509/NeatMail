import { google } from "googleapis";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "./prisma";


export async function getGmailClient(userId: string) {
  try {
    const client = await clerkClient();

    // Get user's Google OAuth token from Clerk
    const externalAccounts = await client.users.getUserOauthAccessToken(
      userId,
      "google",
    );

    const accessToken = externalAccounts.data[0]?.token;

    if (!accessToken) {
      throw new Error(
        "No Google access token found. User needs to reconnect their Google account.",
      );
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    return google.gmail({ version: "v1", auth: oauth2Client });
  } catch (error: any) {
    console.error("Failed to get Gmail client:", {
      userId,
      error: error.message,
      code: error.code,
      status: error.status,
      clerkTraceId: error.clerkTraceId,
    });

    // If it's a Clerk API error related to OAuth tokens
    if (error.code === "api_response_error" && error.status === 400) {
      throw new Error(
        "Google OAuth token has expired or is invalid. Please reconnect your Google account in your user profile.",
      );
    }

    throw error;
  }
}

async function getLabelMap(userId: string) {
  const gmail = await getGmailClient(userId);
  const res = await gmail.users.labels.list({
    userId: "me",
    fields: "labels(id,name)",
  });

  const map = new Map<string, string>();

  res.data.labels?.forEach((label) => {
    map.set(label.id!, label.name!);
  });

  return map;
}

export async function getLabelledMails(userId: string, messageIds: string[]) {
  const gmail = await getGmailClient(userId);

  const labelMap = await getLabelMap(userId);

  const messages = await Promise.all(
    messageIds.map(async (messageId) => {
      try {
        return await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "metadata",
          metadataHeaders: ["From", "Subject"],
          fields: "id,labelIds,internalDate,payload.headers",
        });
      } catch (error: any) {
        // Handle deleted messages or 404 errors
        if (error.code === 404 || error.status === 404) {
          
          return null;
        }
        throw error;
      }
    }),
  );

  // Filter out null results (deleted messages)
  return messages
    .filter((res) => res !== null)
    .map((res) => {
      const headers = res!.data.payload?.headers ?? [];

      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value ?? "";

      const labelNames =
        res!.data.labelIds?.map((id) => labelMap.get(id) ?? id) ?? [];

      return {
        messageId: res!.data.id,
        labels: labelNames,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        internalDate: res!.data.internalDate
          ? new Date(Number(res!.data.internalDate)).toISOString()
          : null,
      };
    });
}

export async function createGmailDraft(
  userId: string,
  threadId: string,
  messageId: string,
  subject: string,
  to: string,
  draftBody: string,
) {
  // Create RFC 2822 formatted message
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const messageParts = [
    "MIME-Version: 1.0",
    `To: ${to}`,
    `Subject: Re: ${utf8Subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    draftBody,
  ];

  const gmail = await getGmailClient(userId);

  const message = messageParts.join("\n");
  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: threadId,
      },
    },
  });

  return draft.data;
}

export async function activateWatch(subscription_id: string) {
  try {
    const clerk = await clerkClient();

    const data = await db.subscription.findUnique({
      where: { dodoSubscriptionId: subscription_id },
      select: {
        clerkUserId: true,
      },
    });

    if (!data?.clerkUserId) {
      throw new Error("Subscription not found or user ID missing");
    }

    const tokenResponse = await clerk.users.getUserOauthAccessToken(
      data.clerkUserId,
      "google",
    );

    const accessToken = tokenResponse.data[0]?.token;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const response = await gmail.users.watch({
      userId: "me",
      requestBody: {
        labelIds: ["INBOX"],
        topicName:
          process.env.GMAIL_WEBHOOK_TOPIC,
      },
    });

    const historyId = response.data.historyId;
    const expiration = response.data.expiration;

    if (!historyId || !expiration) {
      throw new Error("Invalid watch response from Gmail");
    }

    console.log('Watch activated');

    return {
      success: true,
      history_id: historyId,
      userId: data?.clerkUserId,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function deactivateWatch(subscription_id: string) {
  try {
    const clerk = await clerkClient();

    const data = await db.subscription.findUnique({
      where: { dodoSubscriptionId: subscription_id },
      select: {
        clerkUserId: true,
        customerEmail: true,
      },
    });
    if (!data?.clerkUserId) {
      throw new Error("Subscription not found or user ID missing");
    }

    const tokenResponse = await clerk.users.getUserOauthAccessToken(
      data.clerkUserId,
      "google",
    );

    const accessToken = tokenResponse.data[0]?.token;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    await gmail.users.stop({
      userId: "me",
    });

    console.log("✅ Watch deactivated");

    return {
      success: true,
      userId: data?.clerkUserId,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}
