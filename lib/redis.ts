import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:msg:${messageId}`);
  return exists === 1;
}

export async function markMessageProcessed(messageId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:msg:${messageId}`, 86400, 'true');
}

export async function isThreadProcessed(threadId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:thread:${threadId}`);
  return exists === 1;
}

export async function markThreadProcessed(threadId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:thread:${threadId}`, 86400, 'true');
}


export async function isDodoWebhookProcessed(webhookId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:dodo:${webhookId}`);
  return exists === 1;
}

export async function markDodoWebhookProcessed(webhookId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:dodo:${webhookId}`, 86400, 'true');
}
