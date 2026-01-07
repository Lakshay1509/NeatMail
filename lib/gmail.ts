import { google } from 'googleapis';
import { clerkClient } from '@clerk/nextjs/server';

export async function getGmailClient(userId: string) {
  const client = await clerkClient();
  
  // Get user's Google OAuth token from Clerk
  const externalAccounts = await client.users.getUserOauthAccessToken(
    userId,
    'google'
  );
  
  const accessToken = externalAccounts.data[0]?.token;
  
  if (!accessToken) {
    throw new Error('No Google access token found');
  }
  
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function getLabelMap(userId:string) {
  const gmail = await getGmailClient(userId);
  const res = await gmail.users.labels.list({
    userId: "me",
    fields: "labels(id,name)",
  });

  const map = new Map<string, string>();

  res.data.labels?.forEach(label => {
    map.set(label.id!, label.name!);
  });

  return map;
}


export async function getLabelledMails(
  userId: string,
  messageIds: string[]
) {
  const gmail = await getGmailClient(userId);

  
  const labelMap = await getLabelMap(userId);

 
  const messages = await Promise.all(
    messageIds.map((messageId) =>
      gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
        fields: "id,labelIds,internalDate,payload.headers",
      })
    )
  );

  // 3️⃣ Map label IDs → label names
  return messages.map((res) => {
    const headers = res.data.payload?.headers ?? [];

    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value ?? "";

    const labelNames =
      res.data.labelIds?.map(id => labelMap.get(id) ?? id) ?? [];

    return {
      messageId: res.data.id,
      labels: labelNames, 
      subject: getHeader("Subject"),
      from: getHeader("From"),
      internalDate: res.data.internalDate
        ? new Date(Number(res.data.internalDate)).toISOString()
        : null,
    };
  });
}


export async function getRecentEmails(userId: string, maxResults = 15) {
  const gmail = await getGmailClient(userId);

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
  });

  const messages = response.data.messages || [];

  const emailDetails = await Promise.all(
    messages.map(async (message) => {
      const email = await gmail.users.messages.get({
        userId: "me",
        id: message.id!,
        format: "metadata", // faster, enough for headers + labels
      });

      const headers = email.data.payload?.headers || [];
      const labelIds = email.data.labelIds || [];

      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || "";

      return {
        id: email.data.id!,
        threadId: email.data.threadId!,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        snippet: email.data.snippet,

        // ✅ NEW FIELDS
        labels: labelIds,
        isRead: !labelIds.includes("UNREAD"),
        date: new Date(Number(email.data.internalDate)), // reliable
        rawDateHeader: getHeader("Date"), // optional
      };
    })
  );

  return emailDetails;
}



export async function createOrGetLabel(userId: string, labelName: string) {
  const gmail = await getGmailClient(userId);
  
  const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
  const existingLabel = labelsResponse.data.labels?.find(l => l.name === labelName);
  
  if (existingLabel) {
    return existingLabel.id!;
  }
  
  const newLabel = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  
  return newLabel.data.id!;
}

export async function applyLabelsToEmails(
  userId: string,
  messageIds: string[],
  labelName: string
) {
  const gmail = await getGmailClient(userId);
  const labelId = await createOrGetLabel(userId, labelName);
  
  // Get all classification labels to check against
  const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
  const classificationLabels = ["Action Needed", "Read only", "Discussion", "Automated alerts", "Event update", "Pending Response", "Resolved", "Marketing"];
  const classificationLabelIds = labelsResponse.data.labels
    ?.filter(l => classificationLabels.includes(l.name || ''))
    .map(l => l.id) || [];
  
  // Filter out messages that already have a classification label
  const messagesToLabel: string[] = [];
  
  for (const messageId of messageIds) {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'minimal'
    });
    
    const hasClassificationLabel = message.data.labelIds?.some(
      id => classificationLabelIds.includes(id)
    );
    
    if (!hasClassificationLabel) {
      messagesToLabel.push(messageId);
    }
  }
  
  if (messagesToLabel.length > 0) {
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: messagesToLabel,
        addLabelIds: [labelId],
      },
    });
  }
}


export async function createGmailDraft(
  gmail: any,
  threadId: string,
  messageId: string,
  subject: string,
  to: string,
  draftBody: string
) {
  // Create RFC 2822 formatted message
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    'MIME-Version: 1.0',
    `To: ${to}`,
    `Subject: Re: ${utf8Subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    draftBody,
  ];
  
  const message = messageParts.join('\n');
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const draft = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: threadId,
      },
    },
  });

  return draft.data;
}
