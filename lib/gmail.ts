import { google } from "googleapis";
import { clerkClient } from "@clerk/nextjs/server";
import { extractUnsubscribeLinkFromBodyGmail } from "./unsubscribe";

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

function decodeGmailBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function extractBodyFromPart(part: any): string[] {
  if (!part) return [];

  const text: string[] = [];

  if (part.body?.attachmentId) return []; // skip attachments

  if (part.mimeType === "text/plain" && part.body?.data) {
    text.push(decodeGmailBase64Url(part.body.data));
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      text.push(...extractBodyFromPart(child));
    }
  }

  return text;
}

export async function getGmailMessageBody(userId: string, messageId: string) {
  const gmail = await getGmailClient(userId);

  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
    fields: "snippet,payload(mimeType,body,parts)",
  });

  const plainBody = extractBodyFromPart(res.data.payload).join("\n").trim();
  return plainBody.length > 0 ? plainBody : (res.data.snippet ?? "");
}

export async function createGmailDraft(
  userId: string,
  threadId: string,
  messageId: string,
  subject: string,
  to: string,
  draftBody: string,
  fontColor: string,
  fontSize: number,
  signature: string | null,
) {
  // Apply font styling and signature, converting newlines to <br> for HTML
  const formattedBody = draftBody.replace(/\n/g, "<br>");
  const formattedSignature = signature ? signature.replace(/\n/g, "<br>") : "";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: ${fontSize || 14}px; color: ${fontColor || "#000000"};">
      ${formattedBody}
      ${formattedSignature ? `<br><br>--<br>${formattedSignature}` : ""}
    </div>
  `.trim();

  // Create RFC 2822 formatted message
  const subjectPrefix = subject.toLowerCase().startsWith("re:") ? "" : "Re: ";
  const utf8Subject = `=?utf-8?B?${Buffer.from(subjectPrefix + subject).toString("base64")}?=`;
  const messageParts = [
    "MIME-Version: 1.0",
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlContent,
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

export async function activateWatch(userId: string) {
  try {
    const clerk = await clerkClient();

    const tokenResponse = await clerk.users.getUserOauthAccessToken(
      userId,
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
        topicName: process.env.GMAIL_WEBHOOK_TOPIC,
      },
    });

    const historyId = response.data.historyId;
    const expiration = response.data.expiration;

    if (!historyId || !expiration) {
      throw new Error("Invalid watch response from Gmail");
    }

    console.log("Watch activated");

    return {
      success: true,
      history_id: historyId,
      userId: userId,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function deactivateWatch(userId: string) {
  try {
    const clerk = await clerkClient();

    const tokenResponse = await clerk.users.getUserOauthAccessToken(
      userId,
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
      userId: userId,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function unsubscribeFromEmail(userId: string, messageId: string) {
  try {
    const gmail = await getGmailClient(userId);

    // Call API to get the specific metadata header
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["List-Unsubscribe", "List-Unsubscribe-Post"],
    });

    const headers = message.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const unsubscribeHeader = getHeader("List-Unsubscribe");
    const unsubscribePost = getHeader("List-Unsubscribe-Post");

    // The header typically contains comma-separated values like:
    // <https://example.com/unsubscribe>, <mailto:unsubscribe@example.com?subject=Unsubscribe>
    const links = unsubscribeHeader
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
      // Parse the mailto string to extract the email and optional subject
      const emailMatches = mailtoLink.match(/mailto:([^?]+)/i);
      const emailAddress = emailMatches ? emailMatches[1] : null;

      const subjectMatches = mailtoLink.match(/subject=([^&>]+)/i);
      const subject = subjectMatches
        ? decodeURIComponent(subjectMatches[1])
        : "Unsubscribe";

      if (emailAddress) {
        const messageParts = [
          `To: ${emailAddress}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Please unsubscribe me from this mailing list.",
        ];

        const encodedMessage = Buffer.from(messageParts.join("\n"))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: encodedMessage,
          },
        });

        return {
          success: true,
          method: "mailto",
          requiresRedirect: false,
          redirectUrl: mailtoLink,
        };
      }
    } else {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const bodyLink = extractUnsubscribeLinkFromBodyGmail(fullMessage.data.payload);

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
