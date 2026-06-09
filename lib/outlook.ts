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

export async function createOutlookSubscription(
  userId: string,
  folders?: { id: string; name: string }[]
) {
  try {
    // Wipe old subscriptions first so we start clean
    await deleteOutlookSubscription(userId);

    const client = await getGraphClient(userId);
    const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Always include Inbox; append the rest (deduplicate if Inbox is in the list)
    const seen = new Set<string>();
    const targets = [
      { resource: "me/mailFolders/Inbox/messages", name: "Inbox" },
      ...(folders ?? []).map(f => ({ resource: `me/mailFolders/${f.id}/messages`, name: f.name })),
    ].filter(t => {
      if (seen.has(t.resource)) return false;
      seen.add(t.resource);
      return true;
    });

    const results = [];

    for (const target of targets) {
      const data:Subscription = await client.api("/subscriptions").post({
        changeType: "created,updated",
        notificationUrl: `${process.env.NEXT_PUBLIC_API_URL}/api/outlook/webhook`,
        resource: target.resource,
        expirationDateTime,
        clientState: process.env.OUTLOOK_WEBHOOK_SECRET,
      } as Subscription);

      console.log(`Subscription created for [${target.name}]:`, data.id);
      results.push({ ...data, folderName: target.name });
    }

    return results;
  } catch (error) {
    console.error("Failed to create Outlook subscription:", error);
    throw error;
  }
}

export async function deleteOutlookSubscription(userId: string, folderId?: string) {
  try {
    const client = await getGraphClient(userId);

    const response = await client.api("/subscriptions").get() as { value: Subscription[] };

    const toDelete = folderId
      ? response.value?.filter(s => s.resource?.includes(folderId))
      : response.value;

    if (!toDelete?.length) {
      console.log("No Outlook subscriptions found to delete");
      return { success: true, userId };
    }

    await Promise.all(
      toDelete.map(sub =>
        client.api(`/subscriptions/${sub.id}`).delete()
      )
    );

    console.log(`Deleted ${toDelete.length} Outlook subscription(s)`);
    return { success: true, userId };
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return { success: true, userId };
    }
    console.error("Failed to delete Outlook subscription:", error);
    throw error;
  }
}

export interface FolderNode {
  name: string;
  parentPath: string[];
}

export async function getFolderMap(userId: string): Promise<Map<string, FolderNode>> {
  const client = await getGraphClient(userId);
  const map = new Map<string, FolderNode>();

  async function fetchFolders(apiPath: string, parentPath: string[] = []) {
    const response = await client
      .api(apiPath)
      .select("id,displayName,childFolderCount")
      .top(100)
      .get() as { value: { id: string; displayName: string; childFolderCount: number }[] };

    for (const folder of response.value ?? []) {
      map.set(folder.id, { name: folder.displayName, parentPath });

      if (folder.childFolderCount > 0) {
        await fetchFolders(
          `/me/mailFolders/${folder.id}/childFolders`,
          [...parentPath, folder.displayName],
        );
      }
    }
  }

  await fetchFolders("/me/mailFolders");
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
      const folderName = folderMap.get(msg!.parentFolderId)?.name ?? msg!.parentFolderId;
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

export async function deleteOutlookTag(userId: string, tagName: string) {
  const client = await getGraphClient(userId);

  try {
    const categoriesResponse = await client.api("/me/outlook/masterCategories").get();
    const category = categoriesResponse.value?.find((c: any) => c.displayName === tagName);
    
    if (category) {
      await client.api(`/me/outlook/masterCategories/${category.id}`).delete();
    }
  } catch (error: any) {
    console.error("Failed to delete Outlook category:", error);
  }

  try {
    const foldersResponse = await client.api("/me/mailFolders").get();
    const folder = foldersResponse.value?.find((f: any) => f.displayName === tagName);

    if (folder) {
      await client.api(`/me/mailFolders/${folder.id}`).delete();
    }
  } catch (error: any) {
    console.error("Failed to delete Outlook folder:", error);
  }
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
  const neatmailFooter = `<br><br><span style="font-size:11px;color:#888;">Sent with <a href="https://www.neatmail.app" style="color:#888;text-decoration:underline;">NeatMail</a></span>`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: ${fontSize || 14}px; color: ${fontColor || "#000000"};">
      ${formattedBody}
      ${formattedSignature ? `<br><br>--<br>${formattedSignature}` : ""}
      ${neatmailFooter}
    </div>
  `.trim();

  const client = await getGraphClient(userId);

  let draft;
  try {
    draft = await client.api(`/me/messages/${messageId}/createReply`).post({
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
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw new Error("This message has been deleted or moved and is no longer available.");
    }
    throw error;
  }

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
    if (error?.statusCode === 404) {
      throw new Error("This message has been deleted or moved and is no longer available.");
    }
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
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw new Error("This message has been deleted or moved and is no longer available.");
    }
    console.error("Failed to unsubscribe:", error);
    throw error;
  }
}

/**
 * Archive messages by moving them to the Outlook Archive folder.
 * @param userId - The user ID to get Graph client for
 * @param messageIds - Array of message IDs to archive
 * @returns Object with success status, count of archived messages, and failed count
 */
export async function getPreviousOutlookMails(userId: string) {
  const client = await getGraphClient(userId);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const filterDate = fourteenDaysAgo.toISOString().replace(/\.\d{3}Z$/, "Z");

  const messages: { messageId: string; fullemail: string; is_Read: boolean; created_at: string }[] = [];

  let nextLink: string | undefined;

  do {
    try {
      const response = nextLink
        ? await client.api(nextLink).get()
        : await client
            .api("/me/messages")
            .filter(`receivedDateTime ge ${filterDate}`)
            .select("id,from,receivedDateTime,isRead")
            .top(100)
            .get();

      const messageList = (response as any).value ?? [];
      nextLink = (response as any)["@odata.nextLink"];

      for (const msg of messageList) {
        const fullemail = msg.from?.emailAddress
          ? `${msg.from.emailAddress.name} <${msg.from.emailAddress.address}>`
          : "";

        messages.push({
          messageId: msg.id,
          fullemail: fullemail.trim(),
          is_Read: msg.isRead ?? false,
          created_at: msg.receivedDateTime
            ? new Date(msg.receivedDateTime).toISOString()
            : new Date().toISOString(),
        });
      }
    } catch (error: any) {
      console.error("Outlook getPreviousOutlookMails page error:", error);
      break;
    }
  } while (nextLink);

  return messages;
}



interface OutlookMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  sizeEstimate: number;
  hasAttachments: boolean;
  isRead: boolean;
}

interface SearchOutlookResult {
  data: OutlookMessage[];
  nextPageToken: string | undefined;
}

interface SentEmailMessage {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
}

interface SentEmailsResult {
  data: SentEmailMessage[];
  nextPageToken: string | undefined;
}

interface GraphMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  toRecipients?: { emailAddress?: { address?: string } }[];
  sentDateTime?: string;
}

export async function searchOutlook(
  userId: string,
  filter: string,
  maxResults = 20,
  skipToken?: string,
): Promise<SearchOutlookResult> {
  const client: Client = await getGraphClient(userId);

  // size is NOT a selectable property on Graph messages.
  // Must use singleValueExtendedProperties with PidTagMessageSize (0x0E08)
  let req = client
    .api("/me/messages")
    .filter(filter)
    .orderby("receivedDateTime desc")
    .top(maxResults)
    .select([
      "id",
      "conversationId",
      "subject",
      "from",
      "toRecipients",
      "receivedDateTime",
      "bodyPreview",
      "hasAttachments",
      "isRead",
    ].join(","))
    .expand("singleValueExtendedProperties($filter=Id eq 'LONG 0x0E08')");

  if (skipToken) req = req.query({ $skip: skipToken });

  const res = await req.get();

  const messages: any[] = res.value ?? [];
  if (messages.length === 0) return { data: [], nextPageToken: undefined };

  const nextLink: string | undefined = res["@odata.nextLink"];
  const nextPageToken = nextLink
    ? new URL(nextLink).searchParams.get("$skip") ?? undefined
    : undefined;

  const data: OutlookMessage[] = messages.map((msg) => {
    // extract size from extended property
    const sizeStr = msg.singleValueExtendedProperties?.[0]?.value ?? "0";
    const size = parseInt(sizeStr, 10) || 0;

    return {
      id: msg.id ?? "",
      threadId: msg.conversationId ?? "",
      subject: msg.subject ?? "",
      from: msg.from?.emailAddress?.address ?? "",
      to: msg.toRecipients?.[0]?.emailAddress?.address ?? "",
      date: msg.receivedDateTime ?? "",
      snippet: msg.bodyPreview ?? "",
      sizeEstimate:size,
      hasAttachments: msg.hasAttachments ?? false,
      isRead: msg.isRead ?? true,
    };
  });


  return { data, nextPageToken };
}

interface GetFilteredMailsFilters {
  after: string;
  before: string;
  largerThan: number;
  from?: string;
  to?: string;
  isRead?: boolean;
  pageToken?: string;
  maxResults?: number;
}

export async function getFilteredMailsOutlook(
  userId: string,
  filters: GetFilteredMailsFilters,
): Promise<SearchOutlookResult> {
  const parts: string[] = [
    `receivedDateTime ge ${new Date(filters.after).toISOString()}`,
    `receivedDateTime le ${new Date(filters.before).toISOString()}`,
  ];

  if (filters.from) parts.push(`from/emailAddress/address eq '${filters.from}'`);
  if (filters.to) parts.push(`toRecipients/any(r: r/emailAddress/address eq '${filters.to}')`);
  if (filters.isRead !== undefined) parts.push(`isRead eq ${filters.isRead}`);

  const result = await searchOutlook(
    userId,
    parts.join(" and "),
    filters.maxResults ?? 20,
    filters.pageToken,
  );

  const data = result.data
    .filter((msg) => !filters.largerThan || msg.sizeEstimate >= filters.largerThan)
    .sort((a, b) => b.sizeEstimate - a.sizeEstimate);


  return { ...result, data };
}
export async function replyToOutlookConversation(
  userId: string,
  conversationId: string,
  message: string,
  toRecipients?: string[],
) {
  const client = await getGraphClient(userId);

  const messagesRes = (await client
    .api("/me/messages")
    .filter(`conversationId eq '${conversationId}'`)
    .select("id")
    .top(1)
    .get()) as { value?: { id: string }[] };

  const messageId = messagesRes.value?.[0]?.id;
  if (!messageId) throw new Error("No messages found in conversation");

  const formattedBody = message.replace(/\n/g, "<br>");
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #000000;">
      ${formattedBody}
    </div>
  `.trim();

  const requestBody: Record<string, unknown> = {
    message: {
      body: {
        contentType: "HTML",
        content: htmlContent,
      },
    },
  };

  if (toRecipients && toRecipients.length > 0) {
    (requestBody.message as Record<string, unknown>).toRecipients = toRecipients.map((address) => ({
      emailAddress: { address },
    }));
  }

  let result;
  try {
    result = await client.api(`/me/messages/${messageId}/reply`).post(requestBody);
  } catch (error: any) {
    if (error?.statusCode === 404) {
      throw new Error("This message has been deleted or moved and is no longer available.");
    }
    throw error;
  }

  return result;
}

export async function deleteOutlookMessage(userId: string, messageId: string) {
  const client = await getGraphClient(userId);

  try {
    await client.api(`/me/messages/${messageId}`).delete();
    return { success: true, messageId };
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return { success: true, messageId };
    }
    console.error("Failed to delete Outlook message:", error);
    return { success: false, messageId };
  }
}

export async function archiveMessagesOutlook(userId: string, messageIds: string[]) {
  if (!messageIds || messageIds.length === 0) {
    return { success: true, archived: 0, message: "No messages to archive" };
  }

  const client = await getGraphClient(userId);

  // Get the Archive folder ID using well-known folder name
  let archiveFolderId: string;
  try {
    const archiveFolder = await client.api('/me/mailFolders/archive').get();
    archiveFolderId = archiveFolder.id;
  } catch (error: any) {
    console.error("Failed to retrieve Archive folder:", error);
    throw new Error("Unable to access the Archive folder. Please ensure the folder exists.");
  }

  // Move each message to the Archive folder in parallel
  const results = await Promise.allSettled(
    messageIds.map(async (messageId) => {
      try {
        await client.api(`/me/messages/${messageId}/move`).post({
          destinationId: archiveFolderId,
        });
        return { messageId, success: true };
      } catch (error: any) {
        if (error?.statusCode === 404) {
          return { messageId, success: true, skipped: true };
        }
        console.error(`Failed to archive message ${messageId}:`, error);
        return {
          messageId,
          success: false,
          error: error?.message || "Unknown error"
        };
      }
    })
  );

  // Count successes and failures, and collect successfully archived IDs
  let archivedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const archivedIds: string[] = [];

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.success) {
      archivedCount++;
      archivedIds.push(result.value.messageId);
      if ("skipped" in result.value) skippedCount++;
    } else {
      failedCount++;
    }
  });

  const messageParts: string[] = [];
  if (archivedCount > 0) messageParts.push(`Successfully archived ${archivedCount} message(s)`);
  if (skippedCount > 0) messageParts.push(`${skippedCount} were already deleted`);
  if (failedCount > 0) messageParts.push(`${failedCount} failed`);

  return {
    success: failedCount === 0,
    archived: archivedCount,
    archivedIds: archivedIds,
    failed: failedCount,
    skipped: skippedCount,
    message: messageParts.length > 0 ? messageParts.join(". ") + "." : "No messages to archive.",
  };
}

async function outlookSleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function outlookBatch<T>(items: T[], fn: (item: T) => Promise<T | null>, concurrency = 4): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  const queue = [...items];
  let idx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= queue.length) return;
      results[i] = await fn(queue[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function outlookRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.statusCode === 429 && attempt < maxRetries) {
        const retryAfter = err?.response?.headers?.get?.("Retry-After");
        const retryMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * 2 ** attempt + Math.random() * 1000, 30000);
        console.warn(`[outlook] rate limited, retry ${attempt + 1}/${maxRetries} in ${retryMs}ms`);
        await outlookSleep(retryMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function getSentEmailsOutlook(
  userId: string,
  opts?: { maxResults?: number; skip?: number; olderThan?: number; userEmail?: string },
): Promise<SentEmailsResult> {
  const client = await getGraphClient(userId);

  const maxResults = opts?.maxResults ?? 20;
  const days = opts?.olderThan ?? 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // get sent items folder ID to identify user-sent messages via parentFolderId
  const sentFolderRes = await outlookRetry(() => client.api("/me/mailFolders('sentitems')").select("id").get()) as { id: string };
  const sentItemsFolderId = sentFolderRes.id;

  let req = client
    .api("/me/mailFolders('sentitems')/messages")
    .filter(`sentDateTime lt ${since}`)   // lt = older than X days (gt is for testing only)
    .orderby("sentDateTime desc")
    .top(maxResults)
    .select(["id", "conversationId", "subject", "toRecipients", "sentDateTime"].join(","));

  if (opts?.skip) req = req.query({ $skip: opts.skip });

  const res = await outlookRetry(() => req.get()) as {
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
  };

  const messages = res.value ?? [];

  const nextLink = res["@odata.nextLink"];
  const nextPageToken = nextLink
    ? new URL(nextLink).searchParams.get("$skip") ?? undefined
    : undefined;

  if (messages.length === 0) return { data: [], nextPageToken };

  // check each conversation for replies (max 4 concurrent to respect Graph API limit)
  const results = await outlookBatch(messages, async (msg) => {
      if (!msg.conversationId) return null;

      const convRes = await outlookRetry(() =>
        client
          .api("/me/messages")
          .filter(`conversationId eq '${msg.conversationId}'`)
          .select("id,from,sender,sentDateTime,parentFolderId")
          .get(),
      ) as { value?: { id: string; from?: { emailAddress?: { address?: string } }; sender?: { emailAddress?: { address?: string } }; sentDateTime?: string; parentFolderId?: string }[] };

      const convMessages = convRes.value ?? [];
      if (convMessages.length === 0) return null;

      // find messages sent AFTER this one (actual replies to this sent message)
      const replies = convMessages.filter(
        (m) => m.id !== msg.id && new Date(m.sentDateTime ?? 0) > new Date(msg.sentDateTime ?? 0),
      );

      // no replies yet — needs follow-up
      if (replies.length === 0) {
        return {
          id: msg.id ?? "",
          threadId: msg.conversationId ?? "",
          subject: msg.subject ?? "",
          to: msg.toRecipients?.[0]?.emailAddress?.address ?? "",
          date: msg.sentDateTime ?? "",
        } satisfies SentEmailMessage;
      }

      // sort replies by sentDateTime descending to find the latest reply
      const sortedReplies = [...replies].sort(
        (a, b) => new Date(b.sentDateTime ?? 0).getTime() - new Date(a.sentDateTime ?? 0).getTime(),
      );
      const latestReply = sortedReplies[0];

      // if the latest reply is in Sent Items folder → sent by user → still needs follow-up
      if (latestReply.parentFolderId === sentItemsFolderId) {
        return {
          id: msg.id ?? "",
          threadId: msg.conversationId ?? "",
          subject: msg.subject ?? "",
          to: msg.toRecipients?.[0]?.emailAddress?.address ?? "",
          date: latestReply.sentDateTime ?? msg.sentDateTime ?? "",
        } satisfies SentEmailMessage;
      }

      // latest reply was from someone else → no follow-up needed
      return null;
    });
  const data = results.filter(Boolean) as SentEmailMessage[];

  // deduplicate: keep only the latest message per thread
  const seen = new Map<string, SentEmailMessage>();
  for (const msg of data) {
    const existing = seen.get(msg.threadId);
    if (!existing || new Date(msg.date) > new Date(existing.date)) {
      seen.set(msg.threadId, msg);
    }
  }

  return { data: Array.from(seen.values()), nextPageToken };
}

export async function getLastSentMessageInThreadOutlook(
  userId: string,
  threadId: string,
  userEmail: string,
) {
  const client = await getGraphClient(userId);

  const res = await outlookRetry(() =>
    client
      .api("/me/mailFolders('sentitems')/messages")
      .filter(`sentDateTime ge 1900-01-01T00:00:00Z and conversationId eq '${threadId}'`)
      .orderby("sentDateTime desc")
      .top(1)
      .select("id,subject,sentDateTime,body,bodyPreview")
      .header("Prefer", "outlook.body-content-type=text")
      .get(),
  ) as {
    value?: {
      id: string;
      subject?: string;
      sentDateTime?: string;
      body?: { contentType?: string; content?: string };
      bodyPreview?: string;
    }[];
  };

  const message = res.value?.[0];
  if (!message) return null;

  const body = message.body?.content ?? message.bodyPreview ?? "";

  return {
    body,
    date: message.sentDateTime ?? "",
    subject: message.subject ?? "",
  };
}
