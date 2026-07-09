import Redis from 'ioredis';
import { nanoid } from 'nanoid';

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


// Guards against double-applying a referral reward when Dodo redelivers the
// same (or a renewal) `payment.succeeded` webhook. Point-in-time check, not a
// scheduled job, so a short TTL covering the redelivery window is enough.
const REFERRAL_REWARD_GUARD_TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days

const referralRewardGuardKey = (refereeUserId: string) =>
  `referral-reward:${refereeUserId}`;

export async function claimReferralReward(refereeUserId: string): Promise<boolean> {
  const claimed = await redis.set(
    referralRewardGuardKey(refereeUserId),
    '1',
    'EX',
    REFERRAL_REWARD_GUARD_TTL_SECONDS,
    'NX',
  );
  return claimed === 'OK';
}

export async function releaseReferralReward(refereeUserId: string) {
  await redis.del(referralRewardGuardKey(refereeUserId));
}

// Serializes reward application per referrer. Unlike the claim-or-skip guard
// above, two referees of the same referrer converting seconds apart must not
// both read next_billing_date and push the same "+1 month" target, or the
// second push won't compound on the first (a lost-update race). Correctness
// comes from acquire-and-wait plus an atomic compare-and-delete release, not
// from timing. The TTL below is just a crash-safety backstop for a dead
// process; it isn't what makes this correct.
const REFERRER_LOCK_TTL_SECONDS = 60;
const REFERRER_LOCK_RETRY_DELAY_MS = 150;
const REFERRER_LOCK_MAX_WAIT_MS = 10_000;

const referrerLockKey = (referrerUserId: string) => `referral-lock:${referrerUserId}`;

// Compare-and-delete as a single Lua script so we never release a lock we
// don't currently own (e.g. ours expired and someone else already acquired it).
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// Runs `fn` with an exclusive lock on `referrerUserId`, waiting (with
// backoff) up to REFERRER_LOCK_MAX_WAIT_MS if another reward for the same
// referrer is already in flight. Returns null if the lock couldn't be
// acquired in time. Callers should treat that as "not applied yet, retry
// later," never as a hard failure.
export async function withReferrerLock<T>(
  referrerUserId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = referrerLockKey(referrerUserId);
  const token = nanoid();
  const deadline = Date.now() + REFERRER_LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const acquired = await redis.set(key, token, 'EX', REFERRER_LOCK_TTL_SECONDS, 'NX');
    if (acquired === 'OK') {
      try {
        return await fn();
      } finally {
        await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, token).catch(() => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, REFERRER_LOCK_RETRY_DELAY_MS));
  }

  return null;
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


