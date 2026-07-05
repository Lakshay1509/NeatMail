// Anti-hallucination + safety guardrails backed by Redis.
//
//  1. Seen-ID registry — every message id a read tool surfaces is recorded per
//     user. Destructive tools reject ids that were never seen, so the model can
//     never trash/archive an email it invented.
//  2. Pending-action store — destructive actions are staged here (not executed)
//     and only run after the user confirms via POST /api/chat/confirm.

import { redis } from "../redis";
import type { PendingAction } from "./types";

const SEEN_TTL_SECONDS = 3600; // matches the 1h chat-history window
const PENDING_TTL_SECONDS = 600; // a confirmation must happen within 10 min

const seenKey = (userId: string) => `agent:seen:${userId}`;
const metaKey = (userId: string) => `agent:meta:${userId}`;
const pendingKey = (userId: string) => `agent:pending:${userId}`;

/** Record message ids the model is now allowed to act on. */
export async function registerSeen(
  userId: string,
  ids: string[],
): Promise<void> {
  const clean = ids.filter((id) => typeof id === "string" && id.length > 0);
  if (clean.length === 0) return;
  try {
    await redis.sadd(seenKey(userId), ...clean);
    await redis.expire(seenKey(userId), SEEN_TTL_SECONDS);
  } catch (err) {
    console.error("[guardrails] registerSeen failed", err);
  }
}

/**
 * Register seen ids AND cache subject/from per id, so destructive tools can
 * build a grounded confirmation preview without re-fetching each message.
 */
export async function registerSeenItems(
  userId: string,
  items: { id: string; subject?: string; from?: string }[],
): Promise<void> {
  const valid = items.filter((i) => i.id);
  if (valid.length === 0) return;
  const meta: Record<string, string> = {};
  for (const i of valid) {
    meta[i.id] = JSON.stringify({ subject: i.subject ?? "", from: i.from ?? "" });
  }
  try {
    await redis.sadd(seenKey(userId), ...valid.map((i) => i.id));
    await redis.expire(seenKey(userId), SEEN_TTL_SECONDS);
    await redis.hset(metaKey(userId), meta);
    await redis.expire(metaKey(userId), SEEN_TTL_SECONDS);
  } catch (err) {
    console.error("[guardrails] registerSeenItems failed", err);
  }
}

/** Look up cached subject/from for ids (for confirmation previews). */
export async function getSeenMeta(
  userId: string,
  ids: string[],
): Promise<Record<string, { subject: string; from: string }>> {
  if (ids.length === 0) return {};
  try {
    const vals = await redis.hmget(metaKey(userId), ...ids);
    const out: Record<string, { subject: string; from: string }> = {};
    ids.forEach((id, i) => {
      const v = vals[i];
      if (v) {
        try {
          out[id] = JSON.parse(v);
        } catch {
          /* ignore */
        }
      }
    });
    return out;
  } catch (err) {
    console.error("[guardrails] getSeenMeta failed", err);
    return {};
  }
}

/**
 * Split the requested ids into those the model has legitimately seen and those
 * it has not. Fails OPEN on a Redis error (returns everything as seen) so an
 * infra blip never blocks a legitimate action.
 */
export async function partitionSeen(
  userId: string,
  ids: string[],
): Promise<{ seen: string[]; unseen: string[] }> {
  try {
    const members = new Set(await redis.smembers(seenKey(userId)));
    if (members.size === 0) return { seen: ids, unseen: [] };
    const seen: string[] = [];
    const unseen: string[] = [];
    for (const id of ids) (members.has(id) ? seen : unseen).push(id);
    return { seen, unseen };
  } catch (err) {
    console.error("[guardrails] partitionSeen failed, failing open", err);
    return { seen: ids, unseen: [] };
  }
}

/** Stage a destructive action for later confirmation. */
export async function stagePendingAction(
  userId: string,
  action: PendingAction,
): Promise<void> {
  try {
    await redis.setex(
      pendingKey(userId),
      PENDING_TTL_SECONDS,
      JSON.stringify(action),
    );
  } catch (err) {
    console.error("[guardrails] stagePendingAction failed", err);
  }
}

/** Load a staged action, verifying its id matches (guards against stale ids). */
export async function loadPendingAction(
  userId: string,
  actionId: string,
): Promise<PendingAction | null> {
  const action = await loadAnyPendingAction(userId);
  return action && action.id === actionId ? action : null;
}

/** Load whatever action is staged for the user (used by the Telegram confirm path). */
export async function loadAnyPendingAction(
  userId: string,
): Promise<PendingAction | null> {
  try {
    const raw = await redis.get(pendingKey(userId));
    return raw ? (JSON.parse(raw) as PendingAction) : null;
  } catch (err) {
    console.error("[guardrails] loadAnyPendingAction failed", err);
    return null;
  }
}

export async function clearPendingAction(userId: string): Promise<void> {
  try {
    await redis.del(pendingKey(userId));
  } catch (err) {
    console.error("[guardrails] clearPendingAction failed", err);
  }
}
