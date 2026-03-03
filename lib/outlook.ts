import { Client } from "@microsoft/microsoft-graph-client";
import { Subscription } from "@microsoft/microsoft-graph-types";
import { clerkClient } from "@clerk/nextjs/server";

async function getGraphClient(userId: string): Promise<Client> {
  try {
    const clerk = await clerkClient();

    const externalAccounts = await clerk.users.getUserOauthAccessToken(
      userId,
      "microsoft",
    );

    const accessToken = externalAccounts.data[0]?.token;

    if (!accessToken) {
      throw new Error(
        "No Microsoft access token found. User needs to reconnect their Microsoft account.",
      );
    }

    return Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  } catch (error: any) {
    console.error("Failed to build Microsoft Graph client:", {
      userId,
      error: error.message,
      code: error.code,
      status: error.status,
      clerkTraceId: error.clerkTraceId,
    });

    if (error.code === "api_response_error" && error.status === 400) {
      throw new Error(
        "Microsoft OAuth token has expired or is invalid. Please reconnect your Microsoft account in your user profile.",
      );
    }

    throw error;
  }
}

export async function createOutlookSubscription(userId: string) {
  try {
    const client = await getGraphClient(userId);

    // Check if an inbox subscription already exists to avoid duplicates
    const existing = await client.api("/subscriptions").get() as { value: Subscription[] };
    const existingInboxSub = existing.value?.find(
      (sub) => sub.resource === "me/mailFolders/Inbox/messages",
    );

    if (existingInboxSub?.id) {
      console.log("Outlook inbox subscription already exists:", existingInboxSub.id);
      return existingInboxSub;
    }

    const expirationDateTime = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString(); // 3 days

    const subscription: Subscription = {
      changeType: "created",
      notificationUrl: `${process.env.NEXT_PUBLIC_API_URL}/api/outlook/webhook`,
      resource: "me/mailFolders/Inbox/messages",
      expirationDateTime,
      clientState: process.env.OUTLOOK_WEBHOOK_SECRET,
    };

    const data: Subscription = await client.api("/subscriptions").post(subscription);

    console.log("Outlook subscription created:", data.id);

    return data;
  } catch (error) {
    console.error("Failed to create Outlook subscription:", error);
    throw error;
  }
}

export async function deleteOutlookSubscription(userId: string) {
  try {
    const client = await getGraphClient(userId);

    const response = await client.api("/subscriptions").get() as { value: Subscription[] };

    const inboxSub = response.value?.find(
      (sub) => sub.resource === "me/mailFolders/Inbox/messages",
    );

    if (!inboxSub?.id) {
      console.log("No Outlook inbox subscription found to delete");
      return { success: true, userId };
    }

    await client.api(`/subscriptions/${inboxSub.id}`).delete();

    console.log("Outlook subscription deleted:", inboxSub.id);

    return { success: true, userId };
  } catch (error: any) {
    // 404 means it's already gone — treat as success
    if (error?.statusCode === 404) {
      return { success: true, userId };
    }
    console.error("Failed to delete Outlook subscription:", error);
    throw error;
  }
}
