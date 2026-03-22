import { Client } from "@microsoft/microsoft-graph-client";
import { Subscription } from "@microsoft/microsoft-graph-types";
import { clerkClient } from "@clerk/nextjs/server";
import { extractUnsubscribeLinkFromBodyOutlook } from "./unsubscribe";

export async function getGraphClient(userId: string): Promise<Client> {
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
      changeType: "created,updated",
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

async function getFolderMap(userId: string): Promise<Map<string, string>> {
  const client = await getGraphClient(userId);

  const response = await client
    .api("/me/mailFolders")
    .select("id,displayName")
    .top(100)
    .get() as { value: { id: string; displayName: string }[] };

  const map = new Map<string, string>();
  response.value?.forEach((folder) => {
    map.set(folder.id, folder.displayName);
  });

  return map;
}

export async function getLabelledMailsOutlook(userId: string, messageIds: string[]) {
  const client = await getGraphClient(userId);
  const folderMap = await getFolderMap(userId);

  const messages = await Promise.all(
    messageIds.map(async (messageId) => {
      try {
        return await client
          .api(`/me/messages/${messageId}`)
          .select("id,categories,subject,from,receivedDateTime,parentFolderId")
          .get() as {
            id: string;
            categories: string[];
            subject: string;
            from: { emailAddress: { name: string; address: string } };
            receivedDateTime: string;
            parentFolderId: string;
          };
      } catch (error: any) {
        if (error?.statusCode === 404) {
          return null;
        }
        throw error;
      }
    }),
  );

  return messages
    .filter((msg) => msg !== null)
    .map((msg) => {
      const folderName = folderMap.get(msg!.parentFolderId) ?? msg!.parentFolderId;
      const categories: string[] = msg!.categories ?? [];

      // Combine folder name + categories to mirror Gmail's labelIds behavior
      const labels = [folderName, ...categories].filter(Boolean);

      const fromAddress = msg!.from?.emailAddress
        ? `${msg!.from.emailAddress.name} <${msg!.from.emailAddress.address}>`
        : "";

      return {
        messageId: msg!.id,
        labels,
        subject: msg!.subject ?? "",
        from: fromAddress,
        internalDate: msg!.receivedDateTime
          ? new Date(msg!.receivedDateTime).toISOString()
          : null,
      };
    });
}

export async function createOutlookDraft(
  userId: string,
  messageId: string,
  subject: string,
  to: string,
  draftBody: string,
  fontColor: string,
  fontSize: number,
  signature: string | null,
) {
  const formattedBody = draftBody.replace(/\n/g, "<br>");
  const formattedSignature = signature ? signature.replace(/\n/g, "<br>") : "";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: ${fontSize || 14}px; color: ${fontColor || "#000000"};">
      ${formattedBody}
      ${formattedSignature ? `<br><br>--<br>${formattedSignature}` : ""}
    </div>
  `.trim();

  const client = await getGraphClient(userId);

  // Creates a reply draft saved to the Drafts folder (does not send)
  const draft = await client.api(`/me/messages/${messageId}/createReply`).post({
    message: {
      subject: `Re: ${subject}`,
      body: {
        contentType: "HTML",
        content: htmlContent,
      },
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
    },
  });

  return draft;
}

export async function getOutlookMessageBody(userId: string, messageId: string) {
  const client = await getGraphClient(userId);

  try {
    const message = await client
      .api(`/me/messages/${messageId}`)
      .header("Prefer", "outlook.body-content-type=text")
      .select("id,body,bodyPreview,subject")
      .get() as {
        id: string;
        subject?: string;
        body?: { contentType?: "text" | "html" | string; content?: string };
        bodyPreview?: string;
      };

    const content = message.body?.content ?? message.bodyPreview ?? "";
    

    // If Graph API still returned HTML despite the Prefer header, strip it
    // if (contentType === "html" || content.trimStart().startsWith("<")) {
    //   return htmlToPlainText(content);
    // }

    return content;
  } catch (error: any) {
    if (error?.statusCode === 404) return "";
    throw error;
  }
}

export async function unsubscribeFromEmailOutlook(userId: string, messageId: string) {
  try {
    const client = await getGraphClient(userId);

    const message = (await client
      .api(`/me/messages/${messageId}`)
      .select("internetMessageHeaders")
      .get()) as { internetMessageHeaders?: { name: string; value: string }[] };

    const headers = message.internetMessageHeaders || [];
    const unsubscribeHeader = headers.find(
      (h) => h.name.toLowerCase() === "list-unsubscribe"

    )?.value;

    const unsubscribePost= headers.find(
      (h) => h.name.toLowerCase() === "list-unsubscribe-post"

    )?.value;

    const links = (unsubscribeHeader ?? "")
      .split(",")
      .map((link) => link.trim().replace(/^</, "").replace(/>$/, ""));

    const httpLink = links.find((link) => link.startsWith("http"));
    const mailtoLink = links.find((link) => link.startsWith("mailto:"));

    if (httpLink) {
      try {
        // Use POST only if sender explicitly supports one-click (RFC 8058)
        const isOneClick = unsubscribePost?.includes("One-Click");
        const res = await fetch(httpLink, {
          method: isOneClick ? "POST" : "GET",
          ...(isOneClick && {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
          }),
          redirect: "follow",
        });

        if (res.status < 500) {
          return {
            success: true,
            method: "http",
            requiresRedirect: false,
            redirectUrl: httpLink,
          };
        }
      } catch {
        // CORS or network blocked — return URL for client to open in browser
      }

      return {
        success: false,
        method: "redirect",
        requiresRedirect: true,
        redirectUrl: httpLink,
      };
      
    } else if (mailtoLink) {
      const emailMatches = mailtoLink.match(/mailto:([^?]+)/i);
      const emailAddress = emailMatches ? emailMatches[1] : null;

      const subjectMatches = mailtoLink.match(/subject=([^&>]+)/i);
      const subject = subjectMatches
        ? decodeURIComponent(subjectMatches[1])
        : "Unsubscribe";

      if (emailAddress) {
        await client.api("/me/sendMail").post({
          message: {
            subject: subject,
            toRecipients: [
              {
                emailAddress: {
                  address: emailAddress,
                },
              },
            ],
            body: {
              contentType: "Text",
              content: "Please unsubscribe me from this mailing list.",
            },
          },
          saveToSentItems: false,
        });

        return { success: true, method: "mailto", link: mailtoLink };
      }
    }
    else{
      const fullMessage = await getOutlookMessageBody(userId, messageId);
      const bodyLink = extractUnsubscribeLinkFromBodyOutlook(fullMessage);

      if (bodyLink) {
        return {
          success: false,
          method: "redirect",
          requiresRedirect: true,
          redirectUrl: bodyLink,
        };
      }

    }

    throw new Error("Could not parse a valid unsubscribe action from headers.");
  } catch (error) {
    console.error("Failed to unsubscribe:", error);
    throw error;
  }
}
