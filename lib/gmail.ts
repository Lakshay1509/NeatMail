import { google } from "googleapis";
import { clerkClient } from "@clerk/nextjs/server";
import { extractUnsubscribeLinkFromBodyGmail } from "./unsubscribe";
import { applyCorrectionsToText } from "./openai";

interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  messageId: string;
  data?: string; // base64 encoded
}

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function stripQuotedReply(texts: string[]): string[] {
  return texts.map((text) => {
    // Remove quoted lines starting with >
    text = text.replace(/^>.*$/gm, "");

    // Remove "On ... wrote:" and everything after
    text = text.replace(/On .* wrote:[\s\S]*$/, "");

    return text.trim();
  });
}
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
  } else if (part.mimeType === "text/html" && part.body?.data) {
    // Decode and strip HTML tags
    const htmlContent = decodeGmailBase64Url(part.body.data);
    text.push(htmlContent.replace(/<[^>]*>?/gm, "").trim());
  }

  if (Array.isArray(part.parts)) {
    if (part.mimeType === "multipart/alternative") {
      const plainPart = part.parts.find((p: any) => p.mimeType === "text/plain");
      if (plainPart) {
        text.push(...extractBodyFromPart(plainPart));
      } else {
        const htmlPart = part.parts.find((p: any) => p.mimeType === "text/html");
        if (htmlPart) {
          text.push(...extractBodyFromPart(htmlPart));
        } else {
          for (const child of part.parts) {
            text.push(...extractBodyFromPart(child));
          }
        }
      }
    } else {
      for (const child of part.parts) {
        text.push(...extractBodyFromPart(child));
      }
    }
  }

  return stripQuotedReply(text)

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
  const gmail = await getGmailClient(userId);

  let rfcMessageId = "";
  let references = "";
  let originalSubject = subject;
  let fromEmail = "";

  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    fromEmail = profile.data.emailAddress ?? "";
  } catch (err) {
    console.error("getProfile failed:", err);
  }

  try {
    const originalMessage = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References", "Subject"],
    });
    const headers = originalMessage.data.payload?.headers ?? [];

    rfcMessageId    = headers.find((h) => h.name?.toLowerCase() === "message-id")?.value ?? "";
    references      = headers.find((h) => h.name?.toLowerCase() === "references")?.value ?? "";
    originalSubject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? subject;
  } catch (err) {
    console.error("messages.get failed:", err);
  }

  if (rfcMessageId && !rfcMessageId.startsWith("<")) {
    rfcMessageId = `<${rfcMessageId}>`;
  }

  const cleanSubject = originalSubject.replace(/^(re:\s*)*/i, "").trim();
  const replySubject = `Re: ${cleanSubject}`;
  const utf8Subject  = `=?utf-8?B?${Buffer.from(replySubject).toString("base64")}?=`;

  const formattedBody      = draftBody.replace(/\n/g, "<br>");
  const formattedSignature = signature ? signature.replace(/\n/g, "<br>") : "";
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: ${fontSize || 14}px; color: ${fontColor || "#000000"};">
      ${formattedBody}
      ${formattedSignature ? `<br><br>--<br>${formattedSignature}` : ""}
    </div>
  `.trim();

  const encodedBody = Buffer.from(htmlContent).toString("base64");

  const CRLF = "\r\n";
  const messageParts: string[] = [
    "MIME-Version: 1.0",
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
  ];

  if (rfcMessageId) {
    messageParts.push(`In-Reply-To: ${rfcMessageId}`);
    messageParts.push(`References: ${references ? references + " " : ""}${rfcMessageId}`);
  }

  messageParts.push(
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  );

  const raw = messageParts.join(CRLF);
  const encodedMessage = Buffer.from(raw)
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

export async function updateGmailDraft(
  userId: string,
  draftId: string,
  text: string,
) {
  const gmail = await getGmailClient(userId);

  const draft = await gmail.users.drafts.get({
    userId: "me",
    id: draftId,
    format: "full",
  });

  const headers = draft.data.message?.payload?.headers || [];
  const threadId = draft.data.message?.threadId;
  const oldDraftBody = extractBodyFromPart(draft.data.message?.payload).join("\n").trim();

  const newDraft = await applyCorrectionsToText(oldDraftBody,text);


  const to =
    headers.find((h) => h.name?.toLowerCase() === "to")?.value || "";
  const fromEmail =
    headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
  const subject =
    headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
  const inReplyTo =
    headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value || "";
  const references =
    headers.find((h) => h.name?.toLowerCase() === "references")?.value || "";

  const formattedBody = newDraft.replace(/\n/g, "<br>");
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #000000;">
      ${formattedBody}
    </div>
  `.trim();

  const encodedBody = Buffer.from(htmlContent).toString("base64");

  const CRLF = "\r\n";
  const messageParts: string[] = [
    "MIME-Version: 1.0",
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    messageParts.push(`References: ${references}`);
  }

  messageParts.push(
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  );

  const raw = messageParts.join(CRLF);
  const encodedMessage = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const updatedDraft = await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: threadId ,
      },
    },
  });

  return {
    data: updatedDraft.data,
    text: newDraft,
  };
}

export async function sendGmailDraft(userId: string, draftId: string) {
  const gmail = await getGmailClient(userId);

  const response = await gmail.users.drafts.send({
    userId: "me",
    requestBody: {
      id: draftId,
    },
  });

  return response.data;
}

export async function deleteGmailDraft(userId: string, draftId: string) {
  const gmail = await getGmailClient(userId);

  await gmail.users.drafts.delete({
    userId: "me",
    id: draftId,
  });

  return { success: true };
}


export async function searchGmail(
  userId: string,
  query: string,
  maxResults = 10
){
  const gmail = await getGmailClient(userId);
 
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
 
  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) return [];
 
  // Fetch metadata for each message in parallel
  const detailed = await Promise.all(
    messages.map(async (msg) => {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Date"],
      });
 
      const headers = res.data.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
          ?.value ?? "";
 
      return {
        id: msg.id!,
        threadId: msg.threadId!,
        subject: get("Subject"),
        from: get("From"),
        to: get("To"),
        date: get("Date"),
        snippet: res.data.snippet ?? "",
      }
    })
  );
 
  return detailed;
}

export async function getAttachment(userId:string,messageId:string) {

  
  const gmail = await getGmailClient(userId);
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const payload = res.data.payload;
  

  // Check if attachment is directly on payload.body (flat message — no parts array)
  if (payload?.body?.attachmentId) {
    console.log("[getAttachment] ⚠️ attachment found directly on payload.body (flat structure):", payload.body.attachmentId);
  }

  const parts = payload?.parts || [];
  const attachments: Attachment[] = [];

  function extractParts(parts: any[]) {
    for (const part of parts) {
      console.log("[getAttachment] inspecting part:", {
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body?.attachmentId,
        size: part.body?.size,
        hasNestedParts: !!part.parts,
      });

      if (part.parts) {
        extractParts(part.parts); // nested multipart
      }

      const body = part.body;
      const filename = part.filename;

      if (filename && body?.attachmentId) {
        const size = body.size || 0;

        if (size <= MAX_SIZE_BYTES) {
          attachments.push({
            filename,
            mimeType: part.mimeType || "application/octet-stream",
            size,
            attachmentId: body.attachmentId,
            messageId,
          });
        } else {
          console.log(
            `⏭️  Skipping "${filename}" — ${(size / 1024 / 1024).toFixed(1)} MB exceeds 50 MB limit`
          );
        }
      }
    }
  }

  extractParts(parts);
  return attachments;  

}

export async function downloadAttachment(
  userId:string,
  messageId: string,
  attachmentId: string
): Promise<string> {


   const gmail = await getGmailClient(userId);


  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  // Gmail returns URL-safe base64; convert to standard base64
  const data = res.data.data || "";
  return data.replace(/-/g, "+").replace(/_/g, "/");
}