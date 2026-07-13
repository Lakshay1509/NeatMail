import { db } from "./prisma";

/**
 * Billing is owned by exactly one person per organization — the admin. Every
 * other member is just attached to that admin's subscription. So any "is this
 * user subscribed?" / "what tier is this user on?" question must first resolve
 * to the org admin and read *their* subscription/tier, not the caller's own.
 *
 * Resolution steps (mirrors the product rule):
 *   1. Find the caller's organization membership.
 *   2. Find the ADMIN of that organization.
 *   3. Hand back the admin's clerk_user_id so callers key their billing/tier
 *      lookups off it.
 *
 * A user who belongs to no organization is self-billed, so we return their own
 * id unchanged and the rest of the billing code keeps working exactly as before.
 */

type AdminMember = { user_id: string };

/**
 * Given an org's creator id and its ADMIN-role members, pick the canonical
 * billing owner. Pure (no DB) so it can be shared/tested in isolation.
 *
 * Precedence:
 *   - The creator, if they are among the admins. `Organization.created_by` is
 *     unique and required, so it is the most reliable anchor for "who pays".
 *   - Otherwise the earliest-created admin (deterministic when ownership was
 *     handed off or more than one admin exists).
 *   - `undefined` if there are no admins at all (caller decides the fallback).
 */
export function pickBillingAdmin<T extends AdminMember>(
  createdBy: string,
  admins: T[],
): T | undefined {
  if (admins.length === 0) return undefined;
  return admins.find((m) => m.user_id === createdBy) ?? admins[0];
}

/**
 * Resolve the clerk_user_id that owns billing for `userId`.
 *
 * Returns `userId` itself when the user is not in any organization. Inside an
 * org it returns the admin's id (see {@link pickBillingAdmin}). If the ADMIN
 * role was somehow never assigned we fall back to the org creator, which always
 * exists, so this never returns a bogus/empty id for a real org.
 */
export async function getBillingOwnerId(userId: string): Promise<string> {
  const membership = await db.organizationMember.findUnique({
    where: { user_id: userId },
    select: {
      organization: {
        select: {
          created_by: true,
          members: {
            where: { role: "ADMIN" },
            select: { user_id: true },
            orderBy: { created_at: "asc" },
          },
        },
      },
    },
  });

  // Not part of any organization → the user bills for themselves.
  if (!membership) return userId;

  const { created_by, members } = membership.organization;
  return pickBillingAdmin(created_by, members)?.user_id ?? created_by;
}
