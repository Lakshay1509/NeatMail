import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const exists = await redis.exists(`processed:${messageId}`);
  return exists === 1;
}

export async function markMessageProcessed(messageId: string) {
  // Store for 24 hours (86400 seconds)
  await redis.setex(`processed:${messageId}`, 86400, 'true');
}
