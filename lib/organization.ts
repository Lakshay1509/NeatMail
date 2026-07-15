import { db } from "./prisma";

/**
 * Billing is owned by one person per org, the admin. Any "is this user subscribed / what tier" check
 * must resolve to the org admin's id first, not the caller's own. Users with no org resolve to themselves.
 */

type AdminMember = { user_id: string };

/**
 * Picks the billing owner: the org creator if they're an admin, else the earliest-created admin.
 * Undefined if there are no admins (caller decides the fallback).
 */
export function pickBillingAdmin<T extends AdminMember>(
  createdBy: string,
  admins: T[],
): T | undefined {
  if (admins.length === 0) return undefined;
  return admins.find((m) => m.user_id === createdBy) ?? admins[0];
}

/**
 * Falls back to the org creator if no ADMIN role was ever assigned, so this never returns
 * an empty id for a real org.
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

/**
 * True if userId is self-billed or the org admin. Use to gate billing mutations (checkout, plan
 * change, cancel, trial) so a member can't act on billing an org admin already owns.
 */
export async function isBillingOwner(userId: string): Promise<boolean> {
  return (await getBillingOwnerId(userId)) === userId;
}

/**
 * Paid extra-mailbox add-on seats for the billing owner (the tier's included seats
 * are separate — see TIER_LIMITS.maxTeamMembers). Resolves through the org admin, so
 * it's safe to call with a member id. 0 when there is no active subscription.
 *
 * Every effective seat cap is `TIER_LIMITS[tier].maxTeamMembers + getExtraMailboxes(owner)`.
 */
export async function getExtraMailboxes(userId: string): Promise<number> {
  const ownerId = await getBillingOwnerId(userId);
  const sub = await db.subscription.findFirst({
    where: { clerkUserId: ownerId, status: "active" },
    select: { extraMailboxes: true },
    orderBy: { updatedAt: "desc" },
  });
  return sub?.extraMailboxes ?? 0;
}

/**
 * Inverse of getBillingOwnerId: all member ids the given owner administers. Admin's own id is
 * included only if they have a member row.
 */
export async function getOrganizationMemberIds(
  ownerId: string,
): Promise<string[]> {
  const org = await db.organization.findFirst({
    where: {
      OR: [
        { created_by: ownerId },
        { members: { some: { user_id: ownerId, role: "ADMIN" } } },
      ],
    },
    select: { members: { select: { user_id: true } } },
  });
  return org?.members.map((m) => m.user_id) ?? [];
}

/**
 * Owner plus every member they administer, deduped. Billing changes (tier flip, watch
 * activate/deactivate) must be applied to this whole set, not just the owner.
 */
export async function getBillingTeamIds(ownerId: string): Promise<string[]> {
  const members = await getOrganizationMemberIds(ownerId);
  return Array.from(new Set([ownerId, ...members]));
}

/**
 * True if the owner paused this member's access (active=false). Paused members still pass
 * tier gates, so the mail-ingestion path must separately skip them in case a push is in-flight.
 */
export async function isMemberAccessPaused(userId: string): Promise<boolean> {
  const member = await db.organizationMember.findUnique({
    where: { user_id: userId },
    select: { active: true },
  });
  return member ? !member.active : false;
}

/** Solo-org name from email local-part ("alice@example.com" becomes "alice's team"), generic fallback. Cosmetic, renameable later. */
export function soloOrgName(email: string | null | undefined): string {
  const local = email?.split("@")[0]?.trim();
  return local ? `${local}'s team` : "My team";
}

/**
 * Every org this user is or was ever associated with, as a set of org ids:
 *  - an org they own (Organization.created_by),
 *  - an org they currently belong to (OrganizationMember),
 *  - any org they ever joined (a claimed OrganizationInvite.used_by).
 *
 * The claimed-invite entry is the durable one: membership rows are deleted on
 * detach (detachMembersFromOrg), but the used invite survives as long as the
 * org does, so an ex-member still resolves to the org they left.
 */
async function orgIdsEverForUser(userId: string): Promise<Set<string>> {
  const [owned, membership, invites] = await Promise.all([
    db.organization.findUnique({
      where: { created_by: userId },
      select: { id: true },
    }),
    db.organizationMember.findUnique({
      where: { user_id: userId },
      select: { organization_id: true },
    }),
    db.organizationInvite.findMany({
      where: { used_by: userId },
      select: { organization_id: true },
    }),
  ]);

  const ids = new Set<string>();
  if (owned) ids.add(owned.id);
  if (membership) ids.add(membership.organization_id);
  for (const invite of invites) ids.add(invite.organization_id);
  return ids;
}

/**
 * True if two users were EVER on the same team, even after either has left.
 * A member inherits the admin's plan for free, so an admin "referring" their
 * own current-or-former teammate (or the reverse) is circular, not a genuine
 * new customer — referrals between such pairs are blocked.
 *
 * A match means they share an org id across owned / current-member / ever-joined
 * (see orgIdsEverForUser). Everyone owns a distinct solo org, so a solo org
 * never produces a false match; only a genuinely shared org intersects.
 */
export async function haveEverSharedTeam(
  userA: string,
  userB: string,
): Promise<boolean> {
  if (userA === userB) return false;
  const [orgsA, orgsB] = await Promise.all([
    orgIdsEverForUser(userA),
    orgIdsEverForUser(userB),
  ]);
  for (const id of orgsA) {
    if (orgsB.has(id)) return true;
  }
  return false;
}

/**
 * Resets tier to FREE and latches trial_used (already had premium as a member, no fresh trial)
 * before re-issuing a solo org. Doesn't stop the mailbox watch, the caller does that, keeping
 * this module free of a dependency cycle on lib/payement.
 */
export async function detachMembersFromOrg(userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await db.$transaction(async (tx) => {
      await tx.organizationMember.deleteMany({ where: { user_id: userId } });
      const user = await tx.user_tokens.update({
        where: { clerk_user_id: userId },
        data: { tier: "FREE", trial_used: true },
        select: { email: true },
      });
      await tx.organization.createMany({
        data: [{ name: soloOrgName(user.email), created_by: userId }],
        skipDuplicates: true,
      });
    });
  }
}
