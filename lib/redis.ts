import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:msg:${messageId}`);
  return exists === 1;
}

export async function markMessageProcessed(messageId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:msg:${messageId}`, 86400, 'true');
}

export async function unmarkMessageProcessed(messageId: string) {
  await redis.del(`processed:msg:${messageId}`);
}

export async function isThreadProcessed(threadId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:thread:${threadId}`);
  return exists === 1;
}

export async function markThreadProcessed(threadId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:thread:${threadId}`, 86400, 'true');
}

export async function unmarkThreadProcessed(threadId: string) {
  await redis.del(`processed:thread:${threadId}`);
}


// Reconnect reminders are throttled so a flood of webhooks for a user whose
// OAuth token was revoked results in at most one email every few days.
const RECONNECT_REMINDER_TTL = 60 * 60 * 24 * 3; // 3 days

const reconnectReminderKey = (userId: string) =>
  `reconnect-reminder:sent:${userId}`;

// Atomically claims the right to send a reconnect reminder. Returns true only
// for the single caller that wins the SET NX, ensuring concurrent webhooks
// don't each send an email. Caller should release on send failure.
export async function claimReconnectReminder(userId: string): Promise<boolean> {
  const fresh = await redis.set(
    reconnectReminderKey(userId),
    '1',
    'EX',
    RECONNECT_REMINDER_TTL,
    'NX',
  );
  return fresh === 'OK';
}

export async function releaseReconnectReminder(userId: string) {
  await redis.del(reconnectReminderKey(userId));
}


export async function isDodoWebhookProcessed(webhookId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:dodo:${webhookId}`);
  return exists === 1;
}

export async function markDodoWebhookProcessed(webhookId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:dodo:${webhookId}`, 86400, 'true');
}

export async function unmarkDodoWebhookProcessed(webhookId: string) {
  await redis.del(`processed:dodo:${webhookId}`);
}


