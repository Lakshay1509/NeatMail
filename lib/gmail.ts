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
