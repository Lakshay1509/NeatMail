import { Prisma } from "@/prisma/generated/prisma/client";

/**
 * The system category that closes a thread. Follow-up detection relies on it:
 * once a mail is labelled "Resolved" the follow-up is dropped. If a user with
 * follow-ups enabled does not have this tag, that promise silently breaks — so
 * it is force-provisioned/locked whenever follow-ups are on.
 */
export const RESOLVED_TAG_NAME = "Resolved";

// Accepts either the base `db` client (assignable to the narrower tx type) or a
// transaction client from db.$transaction(async (tx) => ...).
type PrismaLike = Prisma.TransactionClient;

/**
 * Idempotently link the "Resolved" system tag into the user's `user_tags`.
 * Returns false (and logs) if the system tag is missing — the caller decides
 * whether that is fatal; provisioning Resolved should never break the primary
 * write it accompanies.
 */
export async function ensureResolvedTag(
  client: PrismaLike,
  userId: string,
): Promise<boolean> {
  const resolvedTag = await client.tag.findFirst({
    where: {
      name: RESOLVED_TAG_NAME,
      OR: [{ user_id: userId }, { user_id: null }],
    },
    select: { id: true },
  });

  if (!resolvedTag) {
    console.error(
      `[ensureResolvedTag] "${RESOLVED_TAG_NAME}" system tag not found for user ${userId}`,
    );
    return false;
  }

  await client.user_tags.createMany({
    data: [{ user_id: userId, tag_id: resolvedTag.id }],
    skipDuplicates: true,
  });

  return true;
}

/**
 * True when the user has follow-ups enabled AND the proposed tag-name set drops
 * "Resolved" — i.e. a category save that would break the follow-up guarantee and
 * should be rejected.
 */
export async function followUpBlocksResolvedRemoval(
  client: PrismaLike,
  userId: string,
  tagNames: string[],
): Promise<boolean> {
  const keepsResolved = tagNames.some(
    (t) => t.trim().toLowerCase() === RESOLVED_TAG_NAME.toLowerCase(),
  );
  if (keepsResolved) return false;

  const pref = await client.follow_up_preference.findUnique({
    where: { user_id: userId },
    select: { enabled: true },
  });

  return pref?.enabled === true;
}
