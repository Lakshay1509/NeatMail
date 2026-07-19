import { redis } from "@/lib/redis";
import { db } from "@/lib/prisma";
import { encryptDomain, encrypt } from "@/lib/encode";
import { dbBatchQueue } from "@/lib/queue";

const BATCH_KEY = "batch:emails";
const READ_HASH_KEY = "batch:emails:reads";
const ARCHIVE_HASH_KEY = "batch:emails:archives";
const FLUSH_SCHEDULED_KEY = "batch:emails:flush-scheduled";
const BATCH_SIZE = 500;
const MAX_ROUNDS = 10;
const COUNT_THRESHOLD = 100;

interface BufferedEmail {
  u: string;
  t: string | null;
  m: string;
  d: string | null;
  s: string | null;
  a: string | null;
}

export async function bufferEmail(
  user_id: string,
  tag_id: string | null,
  message_id: string,
  domain: string | null,
  ai_summary?: string,
  ai_action?: string,
): Promise<void> {
  const normalizedDomain = domain?.trim();
  const encryptedDomain = normalizedDomain
    ? await encryptDomain(normalizedDomain)
    : null;

  const encryptedSummary =
    ai_summary !== undefined && ai_summary.trim().length > 0
      ? await encrypt(ai_summary)
      : null;
  const encryptedAction =
    ai_action !== undefined && ai_action.trim().length > 0
      ? await encrypt(ai_action)
      : null;

  const item: BufferedEmail = {
    u: user_id,
    t: tag_id,
    m: message_id,
    d: encryptedDomain,
    s: encryptedSummary,
    a: encryptedAction,
  };

  const count = await redis.rpush(BATCH_KEY, JSON.stringify(item));

  if (count >= COUNT_THRESHOLD) {
    const alreadyScheduled = await redis.get(FLUSH_SCHEDULED_KEY);
    if (!alreadyScheduled) {
      await redis.setex(FLUSH_SCHEDULED_KEY, 10, "1");
      await dbBatchQueue.add("flush-db-batch", {}, {
        removeOnComplete: true,
        removeOnFail: false,
      });
    }
  }
}

export async function markBufferedEmailRead(
  message_id: string,
  is_read: boolean,
): Promise<void> {
  if (is_read) {
    await redis.hset(READ_HASH_KEY, message_id, "1");
  } else {
    await redis.hdel(READ_HASH_KEY, message_id);
  }

  await db.email_tracked.updateMany({
    where: { message_id },
    data: { is_read },
  });
}

// Mirrors markBufferedEmailRead. The mail workers can auto-archive a noisy
// sender's mail on arrival before its row has landed in the batch, so we
// stash the archive time in Redis and let the next flush pick it up; the
// updateMany below is just a best-effort update if the row's already there.
export async function markBufferedEmailArchived(
  message_id: string,
  archived_at: string,
): Promise<void> {
  await redis.hset(ARCHIVE_HASH_KEY, message_id, archived_at);

  await db.email_tracked.updateMany({
    where: { message_id },
    data: { archive_at: new Date(archived_at) },
  });
}

export async function flushEmailBatch(): Promise<number> {
  let totalInserted = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rawItems = await redis.lrange(BATCH_KEY, 0, BATCH_SIZE - 1);
    if (rawItems.length === 0) break;

    const items: BufferedEmail[] = [];
    const seenMessageIds = new Set<string>();
    // Deduplicate: keep last entry per message_id (later entries are more up-to-date)
    for (let i = rawItems.length - 1; i >= 0; i--) {
      const item: BufferedEmail = JSON.parse(rawItems[i]);
      if (!seenMessageIds.has(item.m)) {
        seenMessageIds.add(item.m);
        items.unshift(item);
      }
    }
    const messageIds = items.map((i) => i.m);

    const pendingReads = await redis.hmget(READ_HASH_KEY, ...messageIds);
    const pendingArchives = await redis.hmget(ARCHIVE_HASH_KEY, ...messageIds);

    const placeholders: string[] = [];
    const params: (string | null | boolean)[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const base = i * 8;
      const isRead = pendingReads[i] === "1";
      const archivedAt = pendingArchives[i] ?? null;
      placeholders.push(
        `($${base + 1}::text, $${base + 2}::uuid, $${base + 3}::text, $${base + 4}::text, $${base + 5}::text, $${base + 6}::text, $${base + 7}::boolean, $${base + 8}::timestamptz)`,
      );
      params.push(
        item.u,
        item.t,
        item.m,
        item.d,
        item.s,
        item.a,
        isRead,
        archivedAt,
      );
    }

    const query = `
      INSERT INTO "email_tracked" ("user_id", "tag_id", "message_id", "domain", "ai_summary", "ai_action", "isRead", "archive_at")
      VALUES ${placeholders.join(",\n  ")}
      ON CONFLICT ("message_id") DO UPDATE SET
        "domain" = COALESCE(EXCLUDED."domain", "email_tracked"."domain"),
        "ai_summary" = COALESCE(EXCLUDED."ai_summary", "email_tracked"."ai_summary"),
        "ai_action" = COALESCE(EXCLUDED."ai_action", "email_tracked"."ai_action"),
        "archive_at" = COALESCE(EXCLUDED."archive_at", "email_tracked"."archive_at")
    `;

    await db.$executeRawUnsafe(query, ...params);

    totalInserted += items.length;
    await redis.ltrim(BATCH_KEY, rawItems.length, -1);
    await redis.hdel(READ_HASH_KEY, ...messageIds);
    await redis.hdel(ARCHIVE_HASH_KEY, ...messageIds);
  }

  return totalInserted;
}
