import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { randomBytes } from "node:crypto";
import { getUserTier } from "@/lib/tier-guard";
import {
  isBillingOwner,
  detachMembersFromOrg,
  soloOrgName,
} from "@/lib/organization";
import { getUserSubscribed } from "@/lib/supabase";
import { handleWatchActivation, handleWatchDeactivation } from "@/lib/payement";
import { TIER_LIMITS } from "@/lib/tiers";
import { sendTeamInviteEmail, sendMemberLeftEmail } from "@/lib/resend";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Set by proxy.ts from a `?invite=<token>` link (httpOnly).
const INVITE_COOKIE = "nm_invite";

// Detaches a member to their own free account (tier FREE, trial_used latched,
// fresh solo org) and stops their mailbox watch. Idempotent. Callers must
// verify the target belongs to their org first.
async function detachMember(userId: string): Promise<void> {
  await detachMembersFromOrg([userId]);
  await handleWatchDeactivation(userId);
}

// Gives a user their own solo org (admin via created_by) when they aren't
// joining someone else's team. Idempotent and race-safe (created_by is unique).
async function ensureSelfOrg(userId: string): Promise<void> {
  const [membership, existing] = await Promise.all([
    db.organizationMember.findUnique({
      where: { user_id: userId },
      select: { id: true },
    }),
    db.organization.findUnique({
      where: { created_by: userId },
      select: { id: true },
    }),
  ]);
  if (membership || existing) return;

  const user = await currentUser();
  const orgName = `${user?.firstName ?? "My"}'s team`;
  try {
    await db.organization.create({
      data: { name: orgName, created_by: userId },
    });
  } catch (err) {
    // A concurrent onboarding load created it first (unique created_by), fine.
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
}

const app = new Hono()

  // Admin generates a revocable, single-use invite link for a teammate.
  .post(
    "/invite",
    zValidator(
      "json",
      z.object({
        email: z.string().email().optional(),
        // Org name, only used the first time an admin invites (lazy creation).
        name: z.string().min(1).max(100).optional(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

      // Only the billing owner may invite. Members inherit the admin's tier,
      // so they can't seat teammates under someone else's plan.
      if (!(await isBillingOwner(userId))) {
        return ctx.json(
          { error: "Only the billing owner can invite members" },
          403,
        );
      }

      // Must be actively covered (paid or trial) to seat a teammate.
      const sub = await getUserSubscribed(userId);
      if (!sub.subscribed) {
        return ctx.json(
          { error: "An active subscription is required to invite members" },
          403,
        );
      }

      const tier = await getUserTier(userId);
      const seatCap = TIER_LIMITS[tier].maxTeamMembers;
      if (seatCap <= 0) {
        return ctx.json(
          { error: "Your plan does not include team members" },
          403,
        );
      }

      const body = ctx.req.valid("json");
      const email = body.email?.trim().toLowerCase();

      // Lazily create the admin's org on first invite (no dedicated creation
      // flow exists). created_by is the billing owner anchor.
      let org = await db.organization.findUnique({
        where: { created_by: userId },
        select: { id: true, name: true },
      });
      if (!org) {
        const user = await currentUser();
        const orgName = body.name?.trim() || `${user?.firstName ?? "My"}'s team`;
        org = await db.organization.create({
          data: { name: orgName, created_by: userId },
          select: { id: true, name: true },
        });
      }

      // Members plus still-open invites must stay under the seat cap.
      const [memberCount, pendingInvites] = await Promise.all([
        db.organizationMember.count({
          where: { organization_id: org.id, role: "MEMBER" },
        }),
        db.organizationInvite.count({
          where: {
            organization_id: org.id,
            used_at: null,
            expires_at: { gt: new Date() },
          },
        }),
      ]);
      if (memberCount + pendingInvites >= seatCap) {
        return ctx.json(
          {
            error: `Seat limit reached (${seatCap} member${seatCap === 1 ? "" : "s"}). Revoke a pending invite or remove a member first.`,
          },
          409,
        );
      }

      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      await db.organizationInvite.create({
        data: {
          token,
          organization_id: org.id,
          email: email ?? null,
          invited_by: userId,
          expires_at: expiresAt,
        },
      });

      const link = `${process.env.NEXT_PUBLIC_API_URL}/onboarding?invite=${token}`;

      // Best-effort: a flaky send must not fail invite creation, the owner
      // still gets the link to share manually. `emailed` tells the UI which happened.
      let emailed = false;
      if (email) {
        try {
          const inviter = await currentUser();
          await sendTeamInviteEmail({
            to: email,
            inviterName: inviter?.firstName ?? null,
            inviterEmail:
              inviter?.primaryEmailAddress?.emailAddress ??
              inviter?.emailAddresses?.[0]?.emailAddress ??
              null,
            teamName: org.name,
            link,
          });
          emailed = true;
        } catch (err) {
          console.error("Failed to send team invite email:", err);
        }
      }

      return ctx.json(
        {
          link,
          token,
          email: email ?? null,
          expires_at: expiresAt,
          emailed,
        },
        200,
      );
    },
  )

  // Invitee consumes an invite. Called during onboarding before the paywall
  // check, so membership exists and coverage resolves to the admin.
  .post(
    "/join",
    zValidator(
      "json",
      z.object({ token: z.string().min(10).max(256).optional() }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

      // Token comes from the body or the httpOnly invite cookie. Resolved
      // before the Clerk round-trip so the common (non-invite) load is cheap.
      const token = ctx.req.valid("json").token ?? getCookie(ctx, INVITE_COOKIE);
      if (!token) {
        // Not an invite flow, this user is their own admin. Safe no-op on
        // repeat onboarding loads.
        await ensureSelfOrg(userId);
        return ctx.json({ role: "admin" as const, noInvite: true }, 200);
      }

      // Drop the cookie so onboarding doesn't reprocess it on reload; the
      // ?invite= URL param remains as a retry path.
      deleteCookie(ctx, INVITE_COOKIE, { path: "/" });

      const user = await currentUser();
      const email = (
        user?.primaryEmailAddress?.emailAddress ??
        user?.emailAddresses[0]?.emailAddress
      )?.toLowerCase();
      if (!email) return ctx.json({ error: "Unauthorized" }, 401);

      const invite = await db.organizationInvite.findUnique({
        where: { token },
        select: {
          organization_id: true,
          email: true,
          used_at: true,
          expires_at: true,
          organization: { select: { created_by: true } },
        },
      });

      // Invite unusable (missing/used/expired/wrong email). Fall through to a
      // solo org instead of stranding a brand-new user with no org.
      if (
        !invite ||
        invite.used_at ||
        invite.expires_at < new Date() ||
        (invite.email && invite.email !== email)
      ) {
        await ensureSelfOrg(userId);
        return ctx.json({ role: "admin" as const, inviteInvalid: true }, 200);
      }

      const adminId = invite.organization.created_by;

      if (adminId === userId) {
        // They clicked their own invite, they already own this org.
        return ctx.json({ role: "admin" as const, self: true }, 200);
      }

      const [ownOrg, ownSub, ownTrial, existing] = await Promise.all([
        db.organization.findUnique({
          where: { created_by: userId },
          select: { id: true },
        }),
        db.subscription.findFirst({
          where: { clerkUserId: userId, status: "active" },
          select: { id: true },
        }),
        // A running free trial also counts as "own coverage": it has no
        // subscription row, so the paid-sub check above misses it.
        db.free_trial.findFirst({
          where: {
            user_id: userId,
            status: "ACTIVE",
            expires_at: { gt: new Date() },
          },
          select: { id: true },
        }),
        db.organizationMember.findUnique({
          where: { user_id: userId },
          select: { organization_id: true },
        }),
      ]);

      // OrganizationMember.user_id is unique, a user belongs to one org.
      if (existing?.organization_id === invite.organization_id) {
        return ctx.json({ role: "member" as const, already: true }, 200);
      }
      // Members of a different team may switch: they only inherit the admin's
      // plan (can't hold their own billing, checkout is gated by isBillingOwner),
      // so leaving orphans nothing. Old membership is dropped in the join tx below.

      // Real blocker: their own active subscription or trial. Must cancel first
      // so we never run two subscriptions or seat a still-paying user elsewhere.
      if (ownSub || ownTrial) {
        return ctx.json(
          {
            error:
              "You have an active subscription or trial. Cancel it before joining a team.",
          },
          409,
        );
      }
      // Owning a team is NOT a blocker: everyone owns a solo org by default
      // (dissolved below). A cancelled ex-admin reaches here with no coverage
      // and their members are already FREE, so the join tx releases them to
      // their own free accounts and dissolves the org instead of trapping the ex-admin.

      // Block joining a team whose owner scheduled account deletion: the reaper
      // cron cascade-deletes the org and would orphan the new member.
      const adminToken = await db.user_tokens.findUnique({
        where: { clerk_user_id: adminId },
        select: { deleted_flag: true },
      });
      if (adminToken?.deleted_flag) {
        return ctx.json(
          { error: "This team is being closed and can't accept new members." },
          403,
        );
      }

      // The team's subscription must be live for the seat to be worth anything.
      const adminSub = await getUserSubscribed(adminId);
      if (!adminSub.subscribed) {
        return ctx.json({ error: "This team's subscription is not active" }, 403);
      }

      const adminTier = await getUserTier(adminId);
      const seatCap = TIER_LIMITS[adminTier].maxTeamMembers;

      // Populated in the tx when a cancelled ex-admin joins; their released
      // members' watches are stopped after commit.
      let releasedMemberIds: string[] = [];

      try {
        await db.$transaction(async (tx) => {
          // Atomically claim the invite, blocks a double-consume race (two tabs).
          const claimed = await tx.organizationInvite.updateMany({
            where: { token, used_at: null },
            data: { used_at: new Date(), used_by: userId },
          });
          if (claimed.count !== 1) throw new Error("INVITE_TAKEN");

          const memberCount = await tx.organizationMember.count({
            where: { organization_id: invite.organization_id, role: "MEMBER" },
          });
          if (memberCount >= seatCap) throw new Error("SEAT_FULL");

          // A member can't also own an org. Usually an empty solo org, but a
          // cancelled ex-admin may still own one with now-uncovered members;
          // release those to their own free accounts before the cascade delete
          // strands them.
          if (ownOrg) {
            const ownedMembers = await tx.organizationMember.findMany({
              // Exclude the caller: they own this org and must never be a member
              // of it. A stray self-membership row is still cleaned by the
              // deleteMany that follows.
              where: { organization_id: ownOrg.id, user_id: { not: userId } },
              select: {
                user_id: true,
                user_tokens: { select: { email: true } },
              },
            });
            for (const m of ownedMembers) {
              await tx.user_tokens.update({
                where: { clerk_user_id: m.user_id },
                data: { tier: "FREE", trial_used: true },
              });
              await tx.organization.createMany({
                data: [
                  {
                    name: soloOrgName(m.user_tokens.email),
                    created_by: m.user_id,
                  },
                ],
                skipDuplicates: true,
              });
            }
            await tx.organizationMember.deleteMany({
              where: { organization_id: ownOrg.id },
            });
            releasedMemberIds = ownedMembers.map((m) => m.user_id);
            await tx.organization.deleteMany({ where: { created_by: userId } });
          }

          // Drop the old membership first so create doesn't collide with the
          // unique user_id. Runs after the seat check, so a full target team
          // rolls back the tx and leaves them in their current team untouched.
          if (existing) {
            await tx.organizationMember.deleteMany({
              where: { user_id: userId },
            });
          }

          await tx.organizationMember.create({
            data: {
              user_id: userId,
              organization_id: invite.organization_id,
              role: "MEMBER",
            },
          });

          // Materialise the member's tier to the admin's so their row is never
          // FREE while covered (keeps the free-tier reaper cron correct).
          await tx.user_tokens.update({
            where: { clerk_user_id: userId },
            data: { tier: adminTier },
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "INVITE_TAKEN") {
          return ctx.json({ error: "This invite has already been used" }, 409);
        }
        if (msg === "SEAT_FULL") {
          return ctx.json({ error: "This team is full" }, 409);
        }
        console.error("Join org error:", err);
        return ctx.json({ error: "Could not join team" }, 500);
      }

      // Stop released members' watches first, so the caller's own activation
      // below is always the last watch operation and can't be clobbered.
      for (const releasedId of releasedMemberIds) {
        await handleWatchDeactivation(releasedId);
      }

      // Returns false (and logs the provider error) if the watch couldn't arm;
      // surfaced so a silent failure isn't left as an unwatched inbox.
      const watchActivated = await handleWatchActivation(userId);
      if (!watchActivated) {
        console.warn(
          `[join] mailbox watch NOT activated for ${userId} after joining ${invite.organization_id} — see the "Failed to activate ... watch" error above (usually a missing/expired Google OAuth token, or an Outlook member with no active folders).`,
        );
      }

      // If they switched teams, tell the old owner a seat freed (mirrors
      // /leave). Best-effort, never fail the join on a flaky send.
      if (existing) {
        try {
          const [oldOrg, member] = await Promise.all([
            db.organization.findUnique({
              where: { id: existing.organization_id },
              select: { name: true, created_by: true },
            }),
            db.user_tokens.findUnique({
              where: { clerk_user_id: userId },
              select: { email: true },
            }),
          ]);
          const oldAdmin = oldOrg
            ? await db.user_tokens.findUnique({
                where: { clerk_user_id: oldOrg.created_by },
                select: { email: true },
              })
            : null;
          if (oldOrg && oldAdmin?.email && member?.email) {
            await sendMemberLeftEmail({
              to: oldAdmin.email,
              memberEmail: member.email,
              teamName: oldOrg.name,
            });
          }
        } catch (err) {
          console.error("Failed to send member-switched email:", err);
        }
      }

      return ctx.json(
        {
          success: true,
          organization_id: invite.organization_id,
          tier: adminTier,
          watchActivated,
        },
        200,
      );
    },
  )

  // Preview an invite without consuming it, for a confirmation screen before
  // committing. Display only, /join re-validates everything on confirm.
  // `alreadyOnboarded` is always resolved so the client can route a returning
  // user to the dashboard vs. a new user through the onboarding wizard.
  .get("/invite/preview", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    // draft_preference is written during onboarding, so its presence is the
    // proxy for "already finished onboarding".
    const draftPref = await db.draft_preference.findUnique({
      where: { user_id: userId },
      select: { user_id: true },
    });
    const alreadyOnboarded = !!draftPref;

    const token = ctx.req.query("token") ?? getCookie(ctx, INVITE_COOKIE);
    if (!token) {
      return ctx.json(
        { alreadyOnboarded, invite: { valid: false as const, reason: "missing" } },
        200,
      );
    }

    const user = await currentUser();
    const email = (
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses[0]?.emailAddress
    )?.toLowerCase();

    const invite = await db.organizationInvite.findUnique({
      where: { token },
      select: {
        organization_id: true,
        email: true,
        used_at: true,
        expires_at: true,
        organization: { select: { name: true, created_by: true } },
      },
    });

    if (
      !invite ||
      invite.used_at ||
      invite.expires_at < new Date() ||
      (invite.email && invite.email !== email)
    ) {
      return ctx.json(
        { alreadyOnboarded, invite: { valid: false as const, reason: "invalid" } },
        200,
      );
    }

    const [membership, ownSub, ownTrial, owner] = await Promise.all([
      db.organizationMember.findUnique({
        where: { user_id: userId },
        select: {
          organization_id: true,
          organization: { select: { name: true } },
        },
      }),
      db.subscription.findFirst({
        where: { clerkUserId: userId, status: "active" },
        select: { id: true },
      }),
      db.free_trial.findFirst({
        where: {
          user_id: userId,
          status: "ACTIVE",
          expires_at: { gt: new Date() },
        },
        select: { id: true },
      }),
      db.user_tokens.findUnique({
        where: { clerk_user_id: invite.organization.created_by },
        select: { deleted_flag: true },
      }),
    ]);

    const self = invite.organization.created_by === userId;
    const alreadyMember = membership?.organization_id === invite.organization_id;

    // Mirrors /join's hard blockers (null = eligible). Being a member of a
    // different team is NOT a blocker, members can switch (see /join). Only
    // own active coverage or a closing team block confirmation.
    let blockedReason: "active_coverage" | "other_team" | "team_closing" | null =
      null;
    if (!self && !alreadyMember) {
      if (owner?.deleted_flag) blockedReason = "team_closing";
      else if (ownSub || ownTrial) blockedReason = "active_coverage";
    }

    // When a member is switching, surface the team they'll leave so the confirm
    // screen can warn them (null unless they're moving from another team).
    const switchingFrom =
      membership && !alreadyMember ? membership.organization.name : null;

    return ctx.json(
      {
        alreadyOnboarded,
        invite: {
          valid: true as const,
          organizationName: invite.organization.name,
          alreadyMember,
          self,
          blockedReason,
          switchingFrom,
        },
      },
      200,
    );
  })

  // Team state for the caller: admin (owner) sees members + pending invites +
  // seat usage; a member sees their team; everyone else has no team.
  .get("/team", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const ownerOrg = await db.organization.findUnique({
      where: { created_by: userId },
      select: { id: true, name: true },
    });

    if (ownerOrg) {
      const [members, invites, tier] = await Promise.all([
        db.organizationMember.findMany({
          where: { organization_id: ownerOrg.id, role: "MEMBER" },
          select: {
            user_id: true,
            role: true,
            active: true,
            created_at: true,
            // watch_activated is the real processing state, distinct from
            // `active` (admin's pause switch): active:true + watch_activated:false
            // means "not actually watching", not "paused by me".
            user_tokens: { select: { email: true, watch_activated: true } },
          },
          orderBy: { created_at: "asc" },
        }),
        db.organizationInvite.findMany({
          where: {
            organization_id: ownerOrg.id,
            used_at: null,
            expires_at: { gt: new Date() },
          },
          select: { id: true, email: true, expires_at: true, created_at: true },
          orderBy: { created_at: "desc" },
        }),
        getUserTier(userId),
      ]);

      const seatLimit = TIER_LIMITS[tier].maxTeamMembers;
      return ctx.json(
        {
          role: "admin" as const,
          organization: ownerOrg,
          seatLimit,
          seatsUsed: members.length,
          // Open invites hold a seat, so surface remaining capacity accurately.
          seatsAvailable: Math.max(0, seatLimit - members.length - invites.length),
          members: members.map((m) => ({
            userId: m.user_id,
            email: m.user_tokens.email,
            role: m.role,
            active: m.active,
            watchActivated: m.user_tokens.watch_activated,
            joinedAt: m.created_at,
          })),
          invites: invites.map((i) => ({
            id: i.id,
            email: i.email,
            expiresAt: i.expires_at,
            createdAt: i.created_at,
          })),
        },
        200,
      );
    }

    const membership = await db.organizationMember.findUnique({
      where: { user_id: userId },
      select: {
        organization: { select: { id: true, name: true, created_by: true } },
      },
    });

    if (membership) {
      const admin = await db.user_tokens.findUnique({
        where: { clerk_user_id: membership.organization.created_by },
        select: { email: true },
      });
      return ctx.json(
        {
          role: "member" as const,
          organization: {
            id: membership.organization.id,
            name: membership.organization.name,
          },
          admin: { email: admin?.email ?? null },
        },
        200,
      );
    }

    return ctx.json({ role: "none" as const }, 200);
  })

  // Admin revokes a still-pending invite.
  .delete(
    "/invite",
    zValidator("json", z.object({ inviteId: z.string().min(1) })),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

      const org = await db.organization.findUnique({
        where: { created_by: userId },
        select: { id: true },
      });
      if (!org) {
        return ctx.json({ error: "Only the team admin can revoke invites" }, 403);
      }

      const { inviteId } = ctx.req.valid("json");
      // Scoped to the caller's org, so an admin can only revoke their own invites.
      const result = await db.organizationInvite.deleteMany({
        where: { id: inviteId, organization_id: org.id },
      });
      if (result.count === 0) {
        return ctx.json({ error: "Invite not found" }, 404);
      }

      return ctx.json({ success: true }, 200);
    },
  )

  // Admin removes a member. The admin can never remove themselves, they're the
  // org's billing anchor (Organization.created_by).
  .delete(
    "/member",
    zValidator("json", z.object({ userId: z.string().min(1) })),
    async (ctx) => {
      const { userId: callerId } = await auth();
      if (!callerId) return ctx.json({ error: "Unauthorized" }, 401);

      const { userId: targetId } = ctx.req.valid("json");

      if (targetId === callerId) {
        return ctx.json(
          { error: "You can't remove yourself from your own team" },
          400,
        );
      }

      const org = await db.organization.findUnique({
        where: { created_by: callerId },
        select: { id: true },
      });
      if (!org) {
        return ctx.json({ error: "Only the team admin can remove members" }, 403);
      }

      const member = await db.organizationMember.findUnique({
        where: { user_id: targetId },
        select: { organization_id: true },
      });
      if (!member || member.organization_id !== org.id) {
        return ctx.json({ error: "That user is not a member of your team" }, 404);
      }

      await detachMember(targetId);
      return ctx.json({ success: true }, 200);
    },
  )

  // Pauses/resumes a teammate's processing without removing them. A paused
  // member keeps their seat and tier; only their Gmail watch stops.
  .patch(
    "/member/access",
    zValidator(
      "json",
      z.object({ userId: z.string().min(1), active: z.boolean() }),
    ),
    async (ctx) => {
      const { userId: callerId } = await auth();
      if (!callerId) return ctx.json({ error: "Unauthorized" }, 401);

      const { userId: targetId, active } = ctx.req.valid("json");

      if (targetId === callerId) {
        return ctx.json({ error: "You can't change your own access" }, 400);
      }

      const org = await db.organization.findUnique({
        where: { created_by: callerId },
        select: { id: true },
      });
      if (!org) {
        return ctx.json(
          { error: "Only the team owner can change member access" },
          403,
        );
      }

      const member = await db.organizationMember.findUnique({
        where: { user_id: targetId },
        select: { organization_id: true, active: true },
      });
      if (!member || member.organization_id !== org.id) {
        return ctx.json({ error: "That user is not a member of your team" }, 404);
      }

      // Idempotent, nothing to do if it's already in the requested state.
      if (member.active === active) {
        return ctx.json({ success: true, active }, 200);
      }

      await db.organizationMember.update({
        where: { user_id: targetId },
        data: { active },
      });

      // Self-isolating watch handlers (they swallow their own errors), so the
      // flag flip is authoritative even if the Gmail call is flaky.
      if (active) {
        await handleWatchActivation(targetId);
      } else {
        await handleWatchDeactivation(targetId);
      }

      return ctx.json({ success: true, active }, 200);
    },
  )

  // A member leaves voluntarily. Owners can't leave (no membership row), they
  // cancel the subscription instead.
  .post("/leave", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const ownsOrg = await db.organization.findUnique({
      where: { created_by: userId },
      select: { id: true },
    });
    if (ownsOrg) {
      return ctx.json(
        { error: "Team owners can't leave. Cancel your subscription to close the team." },
        400,
      );
    }

    const membership = await db.organizationMember.findUnique({
      where: { user_id: userId },
      select: {
        organization: { select: { id: true, name: true, created_by: true } },
      },
    });
    if (!membership) {
      return ctx.json({ error: "You're not part of a team" }, 400);
    }

    const org = membership.organization;
    await detachMember(userId);

    // Best-effort: notify the owner a seat freed. Only for voluntary leaves,
    // admin-initiated removals don't notify. Never fail the leave on a flaky send.
    try {
      const [admin, member] = await Promise.all([
        db.user_tokens.findUnique({
          where: { clerk_user_id: org.created_by },
          select: { email: true },
        }),
        db.user_tokens.findUnique({
          where: { clerk_user_id: userId },
          select: { email: true },
        }),
      ]);
      if (admin?.email && member?.email) {
        await sendMemberLeftEmail({
          to: admin.email,
          memberEmail: member.email,
          teamName: org.name,
        });
      }
    } catch (err) {
      console.error("Failed to send member-left email:", err);
    }

    return ctx.json({ success: true }, 200);
  })

  // Owner and members both see the org name; `canEdit` tells the UI whether
  // the caller (Organization.created_by) may rename it.
  .get("/name", async (ctx) => {
    const { userId } = await auth();
    if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

    const owned = await db.organization.findUnique({
      where: { created_by: userId },
      select: { id: true, name: true },
    });
    if (owned) {
      return ctx.json(
        {
          organizationId: owned.id,
          name: owned.name,
          canEdit: true,
          role: "admin" as const,
        },
        200,
      );
    }

    const membership = await db.organizationMember.findUnique({
      where: { user_id: userId },
      select: { organization: { select: { id: true, name: true } } },
    });
    if (membership) {
      return ctx.json(
        {
          organizationId: membership.organization.id,
          name: membership.organization.name,
          canEdit: false,
          role: "member" as const,
        },
        200,
      );
    }

    return ctx.json(
      {
        organizationId: null,
        name: null,
        canEdit: false,
        role: "none" as const,
      },
      200,
    );
  })

  // Rename the organization. Owner-only (scoped by created_by), so a member can
  // never rename the team they merely belong to.
  .patch(
    "/name",
    zValidator("json", z.object({ name: z.string().min(1).max(100) })),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) return ctx.json({ error: "Unauthorized" }, 401);

      const name = ctx.req.valid("json").name.trim();
      if (!name) {
        return ctx.json({ error: "Team name can't be empty" }, 400);
      }

      const org = await db.organization.findUnique({
        where: { created_by: userId },
        select: { id: true },
      });
      if (!org) {
        return ctx.json(
          { error: "Only the team owner can rename the team" },
          403,
        );
      }

      const updated = await db.organization.update({
        where: { id: org.id },
        data: { name },
        select: { id: true, name: true },
      });

      return ctx.json(
        { success: true, organizationId: updated.id, name: updated.name },
        200,
      );
    },
  );

export default app;
