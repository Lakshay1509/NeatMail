import { beforeEach, describe, expect, it } from "bun:test";

import organization from "@/app/api/[[...route]]/organization";
import { mountRouter } from "../helpers/api";
import { setAuthUser, setClerkUser } from "../helpers/clerk-mock";
import { db } from "../helpers/prisma-mock";
import { gmail, supabaseHelpers } from "../helpers/provider-mock";
import { emailsFrom } from "../helpers/email-mock";

const api = mountRouter("/organization", organization);

const USER = "user_joiner";
const ADMIN = "user_admin";
const ORG = "org_admin";

/**
 * Several Prisma methods serve more than one caller in a single request — the join path
 * alone reads `organizationMember.findUnique` for both the joiner and the admin, and
 * `subscription.findFirst` for the joiner's own coverage and the admin's add-on seats.
 * Routing on the `where` clause keeps them apart instead of depending on call order.
 */
function routeByUser(options: {
  /** organizationMember.findUnique, keyed by user_id. */
  membership?: Record<string, unknown | null>;
  /** organization.findUnique, keyed by created_by. */
  ownedOrg?: Record<string, unknown | null>;
  /** subscription.findFirst, keyed by clerkUserId. */
  subscription?: Record<string, unknown | null>;
  /** user_tokens.findUnique, keyed by clerk_user_id. */
  tokens?: Record<string, unknown | null>;
}) {
  const { membership = {}, ownedOrg = {}, subscription = {}, tokens = {} } = options;

  db.organizationMember.findUnique.mockImplementation(
    async (args: any) => membership[args.where.user_id] ?? null,
  );
  db.organization.findUnique.mockImplementation(async (args: any) => {
    if (args.where.created_by !== undefined) {
      return ownedOrg[args.where.created_by] ?? null;
    }
    return ownedOrg[args.where.id] ?? null;
  });
  db.subscription.findFirst.mockImplementation(
    async (args: any) => subscription[args.where.clerkUserId] ?? null,
  );
  db.user_tokens.findUnique.mockImplementation(
    async (args: any) => tokens[args.where.clerk_user_id] ?? null,
  );
}

/** A live, unclaimed invite into the admin's org. */
function validInvite(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    email: null,
    used_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
    organization: { created_by: ADMIN, name: "Acme" },
    ...overrides,
  };
}

/** The default world: a MAX admin with one free seat, and a joiner with no coverage. */
function programJoin(overrides: Parameters<typeof routeByUser>[0] = {}) {
  routeByUser({
    membership: { [ADMIN]: null, [USER]: null, ...(overrides.membership ?? {}) },
    ownedOrg: { [ADMIN]: { id: ORG }, ...(overrides.ownedOrg ?? {}) },
    subscription: { [ADMIN]: { extraMailboxes: 0 }, ...(overrides.subscription ?? {}) },
    tokens: {
      [ADMIN]: { deleted_flag: false, tier: "MAX", email: "admin@acme.io" },
      [USER]: { tier: "FREE", email: "joiner@acme.io" },
      ...(overrides.tokens ?? {}),
    },
  });
}

beforeEach(() => {
  setAuthUser(USER);
  setClerkUser(USER, {
    emailAddresses: [{ emailAddress: "joiner@acme.io" }],
    firstName: "Jo",
  });
  db.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  );
  db.organizationInvite.updateMany.mockResolvedValue({ count: 1 });
  db.organizationMember.count.mockResolvedValue(0);
  db.organizationInvite.count.mockResolvedValue(0);
  db.organizationMember.findMany.mockResolvedValue([]);
  db.free_trial.findFirst.mockResolvedValue(null);
  programJoin();
});

// ── POST /join ───────────────────────────────────────────────────────────────

describe("POST /api/organization/join", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/organization/join", { body: {} })).status).toBe(401);
  });

  describe("without a usable invite", () => {
    it("gives a tokenless caller their own solo org", async () => {
      const res = await api.post("/organization/join", { body: {} });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ role: "admin", noInvite: true });
      expect(db.organization.create.mock.calls[0][0].data.created_by).toBe(USER);
    });

    it("is a safe no-op when they already have an org", async () => {
      // Onboarding re-loads this; it must not throw or duplicate.
      programJoin({ ownedOrg: { [USER]: { id: "org_solo" } } });

      const res = await api.post("/organization/join", { body: {} });

      expect(res.status).toBe(200);
      expect(db.organization.create).not.toHaveBeenCalled();
    });

    it("tolerates losing the solo-org creation race", async () => {
      const err = Object.assign(new Error("unique"), { code: "P2002" });
      db.organization.create.mockRejectedValue(err);

      expect((await api.post("/organization/join", { body: {} })).status).toBe(200);
    });

    it("falls back to a solo org rather than stranding a user on a bad invite", async () => {
      for (const invite of [
        null,
        validInvite({ used_at: new Date() }),
        validInvite({ expires_at: new Date(Date.now() - 1000) }),
        validInvite({ email: "someone.else@acme.io" }),
      ]) {
        db.organization.create.mockClear();
        db.organizationInvite.findUnique.mockResolvedValue(invite);

        const res = await api.post("/organization/join", {
          body: { token: "tok_invite_1234" },
        });

        expect(res.body).toEqual({ role: "admin", inviteInvalid: true });
        expect(db.organizationMember.create).not.toHaveBeenCalled();
      }
    });

    it("accepts an invite addressed to the caller's own email", async () => {
      db.organizationInvite.findUnique.mockResolvedValue(
        validInvite({ email: "joiner@acme.io" }),
      );

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.body.success).toBe(true);
    });

    it("recognises the admin clicking their own invite", async () => {
      setAuthUser(ADMIN);
      setClerkUser(ADMIN, { emailAddresses: [{ emailAddress: "admin@acme.io" }] });
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.body).toEqual({ role: "admin", self: true });
      expect(db.organizationMember.create).not.toHaveBeenCalled();
    });

    it("is idempotent for someone already in that org", async () => {
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());
      programJoin({ membership: { [USER]: { organization_id: ORG } } });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.body).toEqual({ role: "member", already: true });
      expect(db.organizationInvite.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("blockers", () => {
    beforeEach(() => {
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());
    });

    it("409s when the joiner still holds their own active subscription", async () => {
      // Never run two subscriptions, or seat a still-paying user under someone else.
      programJoin({ subscription: { [USER]: { id: "sub_own" } } });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Cancel it before joining");
      expect(db.organizationMember.create).not.toHaveBeenCalled();
    });

    it("409s when the joiner is inside their own free trial", async () => {
      // A trial has no subscription row, so the paid check above misses it.
      db.free_trial.findFirst.mockResolvedValue({ id: "trial_own" });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(409);
    });

    it("403s when the team owner has scheduled account deletion", async () => {
      // The reaper cron cascade-deletes the org and would orphan the new member.
      programJoin({
        tokens: { [ADMIN]: { deleted_flag: true, tier: "MAX" } },
      });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("being closed");
    });

    it("403s when the team's subscription is not live", async () => {
      supabaseHelpers.getUserSubscribed.mockResolvedValue({ subscribed: false });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(403);
      expect(db.organizationMember.create).not.toHaveBeenCalled();
    });

    it("409s when a concurrent tab already consumed the invite", async () => {
      // The atomic claim is what makes this a 409 rather than a double-seat.
      db.organizationInvite.updateMany.mockResolvedValue({ count: 0 });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already been used");
    });

    it("claims the invite only while it is still unused", async () => {
      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      const claim = db.organizationInvite.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ token: "tok_invite_1234", used_at: null });
      expect(claim.data.used_by).toBe(USER);
      expect(claim.data.used_at).toBeInstanceOf(Date);
    });

    it("409s when the team is already full", async () => {
      // MAX includes one seat; it is taken.
      db.organizationMember.count.mockResolvedValue(1);

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("This team is full");
    });

    it("counts paid add-on seats toward the cap", async () => {
      db.organizationMember.count.mockResolvedValue(1);
      programJoin({ subscription: { [ADMIN]: { extraMailboxes: 2 } } });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
    });

    it("checks the seat cap after claiming, so a full team rolls the claim back", async () => {
      db.organizationMember.count.mockResolvedValue(5);

      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      // Both happened inside one transaction; the thrown SEAT_FULL unwinds it.
      expect(db.organizationInvite.updateMany).toHaveBeenCalled();
      expect(db.organizationMember.create).not.toHaveBeenCalled();
    });

    it("500s on an unexpected transaction failure without leaking internals", async () => {
      db.organizationMember.create.mockRejectedValue(new Error("fk violation"));

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Could not join team" });
    });
  });

  describe("the happy path", () => {
    beforeEach(() => {
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());
    });

    it("creates the membership and materialises the admin's tier", async () => {
      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        organization_id: ORG,
        tier: "MAX",
      });
      expect(db.organizationMember.create.mock.calls[0][0].data).toEqual({
        user_id: USER,
        organization_id: ORG,
        role: "MEMBER",
      });
      // Never leave a covered member's row at FREE — the reaper cron reads that column.
      // Picked by shape: watch activation also writes to user_tokens afterwards.
      const tierWrite = db.user_tokens.update.mock.calls.find(
        (c: any[]) => c[0].data.tier !== undefined,
      )!;
      expect(tierWrite[0]).toEqual({
        where: { clerk_user_id: USER },
        data: { tier: "MAX" },
      });
    });

    it("arms the new member's mailbox watch and reports whether it worked", async () => {
      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.body.watchActivated).toBe(true);
      expect(gmail.activateWatch).toHaveBeenCalledWith(USER);
    });

    it("still joins, flagging the failure, when the watch can't arm", async () => {
      // A silent failure would leave an unwatched inbox on a paid seat.
      gmail.activateWatch.mockResolvedValue({ success: false });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.watchActivated).toBe(false);
    });

    it("accepts the token from the invite cookie as well as the body", async () => {
      const res = await api.post("/organization/join", {
        body: {},
        cookies: { nm_invite: "tok_from_cookie" },
      });

      expect(res.status).toBe(200);
      expect(db.organizationInvite.findUnique.mock.calls[0][0].where.token).toBe(
        "tok_from_cookie",
      );
    });

    it("clears the invite cookie so onboarding can't reprocess it", async () => {
      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.headers.get("set-cookie")).toContain("nm_invite=");
    });
  });

  describe("switching teams", () => {
    beforeEach(() => {
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());
    });

    it("drops the old membership before creating the new one", async () => {
      // OrganizationMember.user_id is unique; create would collide otherwise.
      programJoin({ membership: { [USER]: { organization_id: "org_old" } } });

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
      expect(db.organizationMember.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER },
      });
    });

    it("tells the old owner a seat freed up", async () => {
      programJoin({
        membership: { [USER]: { organization_id: "org_old" } },
        ownedOrg: {
          [ADMIN]: { id: ORG },
          org_old: { name: "Old Team", created_by: "user_old_admin" },
        },
        tokens: {
          [ADMIN]: { deleted_flag: false, tier: "MAX" },
          [USER]: { email: "joiner@acme.io" },
          user_old_admin: { email: "old@acme.io" },
        },
      });

      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      expect(emailsFrom("sendMemberLeftEmail")[0].args[0]).toMatchObject({
        to: "old@acme.io",
        memberEmail: "joiner@acme.io",
        teamName: "Old Team",
      });
    });

    it("never fails the join on a flaky notification", async () => {
      programJoin({
        membership: { [USER]: { organization_id: "org_old" } },
        ownedOrg: {
          [ADMIN]: { id: ORG },
          org_old: { name: "Old Team", created_by: "user_old_admin" },
        },
        tokens: {
          [ADMIN]: { deleted_flag: false, tier: "MAX" },
          [USER]: { email: "joiner@acme.io" },
          user_old_admin: { email: "old@acme.io" },
        },
      });
      const { sendMemberLeftEmail } = await import("@/lib/resend");
      (sendMemberLeftEmail as any).mockRejectedValueOnce(new Error("resend 500"));

      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("a cancelled ex-admin joining someone else's team", () => {
    beforeEach(() => {
      db.organizationInvite.findUnique.mockResolvedValue(validInvite());
      programJoin({ ownedOrg: { [ADMIN]: { id: ORG }, [USER]: { id: "org_theirs" } } });
      db.organizationMember.findMany.mockResolvedValue([
        { user_id: "user_orphan_a", user_tokens: { email: "a@acme.io" } },
        { user_id: "user_orphan_b", user_tokens: { email: "b@acme.io" } },
      ]);
    });

    it("releases their now-uncovered members to their own free accounts", async () => {
      // The cascade delete would otherwise strand them.
      const res = await api.post("/organization/join", {
        body: { token: "tok_invite_1234" },
      });

      expect(res.status).toBe(200);
      const releases = db.user_tokens.update.mock.calls.filter(
        (c: any[]) => c[0].data.trial_used === true,
      );
      expect(releases.map((c: any[]) => c[0].where.clerk_user_id)).toEqual([
        "user_orphan_a",
        "user_orphan_b",
      ]);
      expect(releases[0][0].data).toEqual({ tier: "FREE", trial_used: true });
    });

    it("gives each released member a fresh solo org named from their email", async () => {
      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      const created = db.organization.createMany.mock.calls.map(
        (c: any[]) => c[0].data[0],
      );
      expect(created).toEqual([
        { name: "a's team", created_by: "user_orphan_a" },
        { name: "b's team", created_by: "user_orphan_b" },
      ]);
    });

    it("dissolves the old org and its memberships", async () => {
      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      expect(db.organizationMember.deleteMany).toHaveBeenCalledWith({
        where: { organization_id: "org_theirs" },
      });
      expect(db.organization.deleteMany).toHaveBeenCalledWith({
        where: { created_by: USER },
      });
    });

    it("excludes the caller from the members it releases", async () => {
      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      expect(db.organizationMember.findMany.mock.calls[0][0].where).toEqual({
        organization_id: "org_theirs",
        user_id: { not: USER },
      });
    });

    it("stops released members' watches before arming the caller's own", async () => {
      // Otherwise the caller's activation can be clobbered by a later deactivation.
      const order: string[] = [];
      gmail.deactivateWatch.mockImplementation(async (id: string) => {
        order.push(`stop:${id}`);
        return { success: true };
      });
      gmail.activateWatch.mockImplementation(async (userId: string) => {
        order.push(`start:${userId}`);
        return { success: true, userId, history_id: "h" };
      });

      await api.post("/organization/join", { body: { token: "tok_invite_1234" } });

      expect(order).toEqual([
        "stop:user_orphan_a",
        "stop:user_orphan_b",
        `start:${USER}`,
      ]);
    });
  });
});

// ── POST /leave ──────────────────────────────────────────────────────────────

describe("POST /api/organization/leave", () => {
  beforeEach(() => {
    routeByUser({
      membership: {
        [USER]: {
          organization: { id: ORG, name: "Acme", created_by: ADMIN },
        },
      },
      ownedOrg: {},
      tokens: {
        [ADMIN]: { email: "admin@acme.io" },
        [USER]: { email: "joiner@acme.io" },
      },
    });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/organization/leave")).status).toBe(401);
  });

  it("refuses an owner — they cancel the subscription instead", async () => {
    routeByUser({ ownedOrg: { [USER]: { id: "org_theirs" } } });

    const res = await api.post("/organization/leave");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cancel your subscription");
    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
  });

  it("400s for someone who is not on a team", async () => {
    routeByUser({ membership: {}, ownedOrg: {} });

    const res = await api.post("/organization/leave");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("You're not part of a team");
  });

  it("detaches the member to their own free account", async () => {
    const res = await api.post("/organization/leave");

    expect(res.status).toBe(200);
    expect(db.organizationMember.deleteMany).toHaveBeenCalledWith({
      where: { user_id: USER },
    });
    expect(db.user_tokens.update.mock.calls[0][0].data).toEqual({
      tier: "FREE",
      trial_used: true,
    });
  });

  it("latches trial_used — they already had premium as a teammate", async () => {
    await api.post("/organization/leave");

    expect(db.user_tokens.update.mock.calls[0][0].data.trial_used).toBe(true);
  });

  it("re-issues a solo org so they are never left without one", async () => {
    db.user_tokens.update.mockResolvedValue({ email: "joiner@acme.io" });

    await api.post("/organization/leave");

    expect(db.organization.createMany.mock.calls[0][0]).toEqual({
      data: [{ name: "joiner's team", created_by: USER }],
      skipDuplicates: true,
    });
  });

  it("stops their mailbox watch", async () => {
    await api.post("/organization/leave");

    expect(gmail.deactivateWatch).toHaveBeenCalledWith(USER);
  });

  it("notifies the owner that a seat freed", async () => {
    await api.post("/organization/leave");

    expect(emailsFrom("sendMemberLeftEmail")[0].args[0]).toMatchObject({
      to: "admin@acme.io",
      memberEmail: "joiner@acme.io",
      teamName: "Acme",
    });
  });

  it("still succeeds when that notification fails", async () => {
    db.user_tokens.findUnique.mockRejectedValue(new Error("db blip"));

    const res = await api.post("/organization/leave");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// ── DELETE /member ───────────────────────────────────────────────────────────

describe("DELETE /api/organization/member", () => {
  beforeEach(() => {
    setAuthUser(ADMIN);
    routeByUser({
      ownedOrg: { [ADMIN]: { id: ORG } },
      membership: { [USER]: { organization_id: ORG } },
      tokens: { [USER]: { email: "joiner@acme.io" } },
    });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect(
      (await api.delete("/organization/member", { body: { userId: USER } })).status,
    ).toBe(401);
  });

  it("refuses to remove the admin themselves — they are the billing anchor", async () => {
    const res = await api.delete("/organization/member", {
      body: { userId: ADMIN },
    });

    expect(res.status).toBe(400);
    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
  });

  it("403s a caller who owns no team", async () => {
    routeByUser({ ownedOrg: {}, membership: { [USER]: { organization_id: ORG } } });

    const res = await api.delete("/organization/member", {
      body: { userId: USER },
    });

    expect(res.status).toBe(403);
    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
  });

  it("404s for a user in a different team — no cross-org removals", async () => {
    routeByUser({
      ownedOrg: { [ADMIN]: { id: ORG } },
      membership: { [USER]: { organization_id: "org_someone_else" } },
    });

    const res = await api.delete("/organization/member", {
      body: { userId: USER },
    });

    expect(res.status).toBe(404);
    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
  });

  it("404s for a user who is on no team at all", async () => {
    routeByUser({ ownedOrg: { [ADMIN]: { id: ORG } }, membership: {} });

    expect(
      (await api.delete("/organization/member", { body: { userId: USER } })).status,
    ).toBe(404);
  });

  it("detaches the member and stops their watch", async () => {
    const res = await api.delete("/organization/member", {
      body: { userId: USER },
    });

    expect(res.status).toBe(200);
    expect(db.organizationMember.deleteMany).toHaveBeenCalledWith({
      where: { user_id: USER },
    });
    expect(db.user_tokens.update.mock.calls[0][0].data).toEqual({
      tier: "FREE",
      trial_used: true,
    });
    expect(gmail.deactivateWatch).toHaveBeenCalledWith(USER);
  });

  it("does not notify the removed member — only voluntary leaves email", async () => {
    await api.delete("/organization/member", { body: { userId: USER } });

    expect(emailsFrom("sendMemberLeftEmail")).toHaveLength(0);
  });

  it("400s on a missing userId", async () => {
    expect((await api.delete("/organization/member", { body: {} })).status).toBe(400);
  });
});

// ── PATCH /member/access ─────────────────────────────────────────────────────

describe("PATCH /api/organization/member/access", () => {
  beforeEach(() => {
    setAuthUser(ADMIN);
    routeByUser({
      ownedOrg: { [ADMIN]: { id: ORG } },
      membership: { [USER]: { organization_id: ORG, active: true } },
    });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect(
      (
        await api.patch("/organization/member/access", {
          body: { userId: USER, active: false },
        })
      ).status,
    ).toBe(401);
  });

  it("refuses the admin changing their own access", async () => {
    const res = await api.patch("/organization/member/access", {
      body: { userId: ADMIN, active: false },
    });

    expect(res.status).toBe(400);
  });

  it("403s a caller who owns no team", async () => {
    routeByUser({ ownedOrg: {}, membership: { [USER]: { organization_id: ORG } } });

    expect(
      (
        await api.patch("/organization/member/access", {
          body: { userId: USER, active: false },
        })
      ).status,
    ).toBe(403);
  });

  it("pauses a member without removing them", async () => {
    // A paused member keeps their seat, row and tier; only the watch stops.
    const res = await api.patch("/organization/member/access", {
      body: { userId: USER, active: false },
    });

    expect(res.status).toBe(200);
    expect(db.organizationMember.update.mock.calls[0][0]).toEqual({
      where: { user_id: USER },
      data: { active: false },
    });
    expect(gmail.deactivateWatch).toHaveBeenCalledWith(USER);
    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
  });

  it("resumes a paused member and re-arms their watch", async () => {
    routeByUser({
      ownedOrg: { [ADMIN]: { id: ORG } },
      membership: { [USER]: { organization_id: ORG, active: false } },
    });

    const res = await api.patch("/organization/member/access", {
      body: { userId: USER, active: true },
    });

    expect(res.status).toBe(200);
    expect(gmail.activateWatch).toHaveBeenCalledWith(USER);
  });

  it("is idempotent when already in the requested state", async () => {
    const res = await api.patch("/organization/member/access", {
      body: { userId: USER, active: true },
    });

    expect(res.status).toBe(200);
    expect(db.organizationMember.update).not.toHaveBeenCalled();
    expect(gmail.activateWatch).not.toHaveBeenCalled();
  });

  it("404s for a member of another team", async () => {
    routeByUser({
      ownedOrg: { [ADMIN]: { id: ORG } },
      membership: { [USER]: { organization_id: "org_other", active: true } },
    });

    expect(
      (
        await api.patch("/organization/member/access", {
          body: { userId: USER, active: false },
        })
      ).status,
    ).toBe(404);
  });
});

// ── Invites ──────────────────────────────────────────────────────────────────

describe("POST /api/organization/invite", () => {
  beforeEach(() => {
    setAuthUser(ADMIN);
    setClerkUser(ADMIN, {
      firstName: "Ada",
      emailAddresses: [{ emailAddress: "admin@acme.io" }],
    });
    routeByUser({
      membership: { [ADMIN]: null },
      ownedOrg: { [ADMIN]: { id: ORG, name: "Acme" } },
      subscription: { [ADMIN]: { extraMailboxes: 0 } },
      tokens: { [ADMIN]: { tier: "MAX" } },
    });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/organization/invite", { body: {} })).status).toBe(401);
  });

  it("403s a non-admin member", async () => {
    routeByUser({
      membership: {
        [ADMIN]: {
          organization: { created_by: "user_other", members: [{ user_id: "user_other" }] },
        },
      },
    });

    const res = await api.post("/organization/invite", { body: {} });

    expect(res.status).toBe(403);
    expect(db.organizationInvite.create).not.toHaveBeenCalled();
  });

  it("403s without an active subscription", async () => {
    supabaseHelpers.getUserSubscribed.mockResolvedValue({ subscribed: false });

    expect((await api.post("/organization/invite", { body: {} })).status).toBe(403);
  });

  it("403s on a plan with no team seats", async () => {
    routeByUser({
      membership: { [ADMIN]: null },
      ownedOrg: { [ADMIN]: { id: ORG, name: "Acme" } },
      subscription: { [ADMIN]: { extraMailboxes: 0 } },
      tokens: { [ADMIN]: { tier: "PRO" } },
    });

    const res = await api.post("/organization/invite", { body: {} });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not include team members");
  });

  it("issues a single-use link with a 7-day expiry", async () => {
    const res = await api.post("/organization/invite", { body: {} });

    expect(res.status).toBe(200);
    expect(res.body.link).toContain(`/onboarding?invite=${res.body.token}`);
    const created = db.organizationInvite.create.mock.calls[0][0].data;
    expect(created.organization_id).toBe(ORG);
    expect(created.invited_by).toBe(ADMIN);
    const ttlDays =
      (new Date(created.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(6.9);
    expect(ttlDays).toBeLessThan(7.1);
  });

  it("counts pending invites against the cap, not just members", async () => {
    // Otherwise an admin can issue unlimited invites and oversubscribe the team.
    db.organizationMember.count.mockResolvedValue(0);
    db.organizationInvite.count.mockResolvedValue(1);

    const res = await api.post("/organization/invite", { body: {} });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Seat limit reached");
    expect(db.organizationInvite.create).not.toHaveBeenCalled();
  });

  it("only counts invites that are still open", async () => {
    await api.post("/organization/invite", { body: {} });

    const where = db.organizationInvite.count.mock.calls[0][0].where;
    expect(where.used_at).toBeNull();
    expect(where.expires_at.gt).toBeInstanceOf(Date);
  });

  it("creates the org lazily on the first invite", async () => {
    routeByUser({
      membership: { [ADMIN]: null },
      ownedOrg: {},
      subscription: { [ADMIN]: { extraMailboxes: 0 } },
      tokens: { [ADMIN]: { tier: "MAX" } },
    });
    db.organization.create.mockResolvedValue({ id: "org_new", name: "Ada's team" });

    const res = await api.post("/organization/invite", { body: {} });

    expect(res.status).toBe(200);
    expect(db.organization.create.mock.calls[0][0].data).toEqual({
      name: "Ada's team",
      created_by: ADMIN,
    });
  });

  it("reports emailed:false when the send fails, keeping the link usable", async () => {
    const { sendTeamInviteEmail } = await import("@/lib/resend");
    (sendTeamInviteEmail as any).mockRejectedValueOnce(new Error("resend 500"));

    const res = await api.post("/organization/invite", {
      body: { email: "New.Person@Acme.io" },
    });

    expect(res.status).toBe(200);
    expect(res.body.emailed).toBe(false);
    expect(res.body.link).toBeTruthy();
  });

  it("lowercases the invited email", async () => {
    const res = await api.post("/organization/invite", {
      body: { email: "New.Person@Acme.io" },
    });

    expect(res.body.email).toBe("new.person@acme.io");
    expect(res.body.emailed).toBe(true);
  });

  it("NOTE: a padded email is rejected by validation before the route can trim it", async () => {
    // The handler does `body.email?.trim()`, but zValidator runs first and
    // `z.string().email()` fails on surrounding whitespace — so the trim never applies
    // to this case. An admin pasting an address with a trailing space gets a 400 rather
    // than an invite. Fix by trimming in the schema (`z.string().trim().email()`).
    const res = await api.post("/organization/invite", {
      body: { email: "  new.person@acme.io  " },
    });

    expect(res.status).toBe(400);
  });

  it("400s on a malformed email", async () => {
    expect(
      (await api.post("/organization/invite", { body: { email: "not-an-email" } }))
        .status,
    ).toBe(400);
  });
});

describe("DELETE /api/organization/invite", () => {
  beforeEach(() => {
    setAuthUser(ADMIN);
    routeByUser({ ownedOrg: { [ADMIN]: { id: ORG } } });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect(
      (await api.delete("/organization/invite", { body: { inviteId: "inv_1" } }))
        .status,
    ).toBe(401);
  });

  it("403s a caller who owns no team", async () => {
    routeByUser({ ownedOrg: {} });

    expect(
      (await api.delete("/organization/invite", { body: { inviteId: "inv_1" } }))
        .status,
    ).toBe(403);
  });

  it("revokes only an unused invite scoped to the caller's own org", async () => {
    // A claimed invite is the durable record that someone was ever a teammate —
    // the referral guard depends on it, so it must never be revocable.
    db.organizationInvite.deleteMany.mockResolvedValue({ count: 1 });

    const res = await api.delete("/organization/invite", {
      body: { inviteId: "inv_1" },
    });

    expect(res.status).toBe(200);
    expect(db.organizationInvite.deleteMany.mock.calls[0][0].where).toEqual({
      id: "inv_1",
      organization_id: ORG,
      used_at: null,
    });
  });

  it("404s when nothing matched — wrong org, or already claimed", async () => {
    db.organizationInvite.deleteMany.mockResolvedValue({ count: 0 });

    const res = await api.delete("/organization/invite", {
      body: { inviteId: "inv_other" },
    });

    expect(res.status).toBe(404);
  });
});
