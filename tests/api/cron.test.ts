import { beforeEach, describe, expect, it } from "bun:test";

import cron from "@/app/api/[[...route]]/cron";
import { mountRouter } from "../helpers/api";
import { db } from "../helpers/prisma-mock";
import { gmail } from "../helpers/provider-mock";
import { setClerkUser } from "../helpers/clerk-mock";

const api = mountRouter("/cron", cron);

const AUTH = { "x-authorization": "Bearer test-cron-secret" };

/** Every cron endpoint, with the method and a body where the route needs one. */
const ENDPOINTS: { method: "get" | "post"; path: string; body?: unknown }[] = [
  { method: "get", path: "/cron/delete-user" },
  { method: "get", path: "/cron/renew-watch" },
  { method: "get", path: "/cron/mail/send-reminder" },
  { method: "get", path: "/cron/deactivate-trials" },
  { method: "post", path: "/cron/archive-messages" },
  { method: "post", path: "/cron/sendNewMails", body: { mails: ["a@example.com"] } },
  { method: "get", path: "/cron/send-daily-digest" },
];

beforeEach(() => {
  db.user_tokens.findMany.mockResolvedValue([]);
  db.free_trial.findMany.mockResolvedValue([]);
  db.archiveRule.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  );
});

// ── The shared secret ────────────────────────────────────────────────────────

describe("CRON_SECRET gate", () => {
  it("401s every endpoint without a token", async () => {
    for (const { method, path, body } of ENDPOINTS) {
      const res = await api[method](path, body ? { body } : {});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    }
  });

  it("401s every endpoint with a wrong token", async () => {
    for (const { method, path, body } of ENDPOINTS) {
      const res = await api[method](path, {
        headers: { "x-authorization": "Bearer wrong-secret" },
        ...(body ? { body } : {}),
      });
      expect(res.status).toBe(401);
    }
  });

  it("401s on a bare token missing the Bearer prefix", async () => {
    const res = await api.get("/cron/delete-user", {
      headers: { "x-authorization": "test-cron-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("does no work at all when rejected", async () => {
    // The deletion cron is irreversible; an unauthorised call must not reach the DB.
    await api.get("/cron/delete-user");

    expect(db.user_tokens.findMany).not.toHaveBeenCalled();
    expect(db.user_tokens.delete).not.toHaveBeenCalled();
  });

  it("accepts the correct token", async () => {
    for (const { method, path, body } of ENDPOINTS) {
      const res = await api[method](path, {
        headers: AUTH,
        ...(body ? { body } : {}),
      });
      expect(res.status).not.toBe(401);
    }
  });

  it("NOTE: /sendNewMails validates the body before checking auth", async () => {
    // Documents ordering, not a data leak: zValidator is registered as middleware and
    // runs first, so an unauthenticated caller with a bad body sees 400 rather than 401.
    // No side effect occurs either way. Move the auth check into a middleware if you'd
    // rather unauthenticated callers learn nothing about the schema.
    const res = await api.post("/cron/sendNewMails", { body: { mails: [] } });

    expect(res.status).toBe(400);
  });
});

// ── /delete-user ─────────────────────────────────────────────────────────────

describe("GET /api/cron/delete-user", () => {
  const dueUser = { clerk_user_id: "user_doomed", email: "doomed@acme.io" };

  beforeEach(() => {
    setClerkUser("user_doomed");
    db.organization.findFirst.mockResolvedValue(null); // owns no team
  });

  it("only selects users whose deletion date has passed", async () => {
    await api.get("/cron/delete-user", { headers: AUTH });

    const where = db.user_tokens.findMany.mock.calls[0][0].where;
    expect(where.deleted_flag).toBe(true);
    expect(where.delete_at.lte).toBeInstanceOf(Date);
  });

  it("deletes nothing when nobody is due", async () => {
    const res = await api.get("/cron/delete-user", { headers: AUTH });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, successful: 0, failed: 0 });
    expect(db.user_tokens.delete).not.toHaveBeenCalled();
  });

  it("deletes a due user from Clerk and the database", async () => {
    db.user_tokens.findMany.mockResolvedValue([dueUser]);

    const res = await api.get("/cron/delete-user", { headers: AUTH });

    expect(res.body).toMatchObject({ total: 1, successful: 1, failed: 0 });
    expect(db.user_tokens.delete.mock.calls[0][0]).toEqual({
      where: { clerk_user_id: "user_doomed" },
    });
  });

  it("releases org members before the cascade wipes their org", async () => {
    // Otherwise they survive as ghosts: MAX tier, watched, unpaid.
    db.user_tokens.findMany.mockResolvedValue([dueUser]);
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: "user_member_a" }, { user_id: "user_member_b" }],
    });

    await api.get("/cron/delete-user", { headers: AUTH });

    const release = db.user_tokens.updateMany.mock.calls[0][0];
    expect(release.where.clerk_user_id.in).toEqual([
      "user_member_a",
      "user_member_b",
    ]);
    // trial_used latched: they already had MAX as teammates.
    expect(release.data).toEqual({ tier: "FREE", trial_used: true });
    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_member_a");
    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_member_b");
  });

  it("releases members BEFORE deleting the owner", async () => {
    const order: string[] = [];
    db.user_tokens.findMany.mockResolvedValue([dueUser]);
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: "user_member_a" }],
    });
    db.user_tokens.updateMany.mockImplementation(async () => {
      order.push("release");
      return { count: 1 };
    });
    db.user_tokens.delete.mockImplementation(async () => {
      order.push("delete");
      return {};
    });

    await api.get("/cron/delete-user", { headers: AUTH });

    expect(order).toEqual(["release", "delete"]);
  });

  it("skips the release step for a user with no team", async () => {
    db.user_tokens.findMany.mockResolvedValue([dueUser]);
    db.organization.findFirst.mockResolvedValue(null);

    await api.get("/cron/delete-user", { headers: AUTH });

    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
  });

  it("isolates a failure to one user and keeps going", async () => {
    db.user_tokens.findMany.mockResolvedValue([
      { clerk_user_id: "user_a" },
      { clerk_user_id: "user_b" },
    ]);
    setClerkUser("user_a");
    setClerkUser("user_b");
    db.user_tokens.delete.mockImplementation(async (args: any) => {
      if (args.where.clerk_user_id === "user_a") throw new Error("fk violation");
      return {};
    });

    const res = await api.get("/cron/delete-user", { headers: AUTH });

    expect(res.body).toMatchObject({ total: 2, successful: 1, failed: 1 });
    expect(res.body.errors[0]).toContain("user_a");
  });

  it("still deletes the account when the downstream model cleanup fails", async () => {
    // Vector/classification cleanup is best-effort; it must not strand the deletion.
    db.user_tokens.findMany.mockResolvedValue([dueUser]);
    const { deleteUser } = await import("@/lib/draft");
    (deleteUser as any).mockRejectedValueOnce(new Error("draft api 500"));

    const res = await api.get("/cron/delete-user", { headers: AUTH });

    expect(res.body).toMatchObject({ successful: 1, failed: 0 });
  });
});

// ── /deactivate-trials ───────────────────────────────────────────────────────

describe("GET /api/cron/deactivate-trials", () => {
  const expiredTrial = {
    user_id: "user_trialist",
    user_tokens: { email: "trialist@acme.io" },
  };

  beforeEach(() => {
    setClerkUser("user_trialist");
    db.free_trial.findMany.mockResolvedValue([]);
    db.free_trial.updateMany.mockResolvedValue({ count: 0 });
    db.subscription.findFirst.mockResolvedValue(null);
    db.email_tracked.count.mockResolvedValue(0);
  });

  it("only expires trials that are ACTIVE and past their date", async () => {
    await api.get("/cron/deactivate-trials", { headers: AUTH });

    const where = db.free_trial.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.expires_at.lte).toBeInstanceOf(Date);
  });

  it("marks expired trials and downgrades the user to FREE", async () => {
    db.free_trial.findMany.mockResolvedValue([expiredTrial]);

    const res = await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(db.free_trial.updateMany.mock.calls[0][0].data).toEqual({
      status: "EXPIRED",
    });
    expect(db.user_tokens.update.mock.calls[0][0]).toEqual({
      where: { clerk_user_id: "user_trialist" },
      data: { tier: "FREE" },
    });
    expect(res.body).toMatchObject({ trialsExpired: 1, tierDowngraded: 1 });
  });

  it("does NOT downgrade a trialist who has since subscribed", async () => {
    // The single check standing between a paying customer and losing their plan.
    db.free_trial.findMany.mockResolvedValue([expiredTrial]);
    db.subscription.findFirst.mockResolvedValue({ id: "sub_1", status: "active" });

    const res = await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(db.user_tokens.update).not.toHaveBeenCalled();
    expect(gmail.deactivateWatch).not.toHaveBeenCalled();
    expect(res.body.tierDowngraded).toBe(0);
  });

  it("checks for an ACTIVE subscription specifically", async () => {
    db.free_trial.findMany.mockResolvedValue([expiredTrial]);

    await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(db.subscription.findFirst.mock.calls[0][0].where).toEqual({
      clerkUserId: "user_trialist",
      status: "active",
    });
  });

  it("stops the watch for a downgraded trialist", async () => {
    db.free_trial.findMany.mockResolvedValue([expiredTrial]);

    const res = await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_trialist");
    expect(res.body.trialsDeactivated).toBe(1);
  });

  it("isolates a per-user failure and reports it", async () => {
    db.free_trial.findMany.mockResolvedValue([
      expiredTrial,
      { user_id: "user_other", user_tokens: { email: "other@acme.io" } },
    ]);
    setClerkUser("user_other");
    db.user_tokens.update.mockImplementation(async (args: any) => {
      if (args.where.clerk_user_id === "user_trialist") throw new Error("db error");
      return {};
    });

    const res = await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toContain("user_trialist");
    expect(res.body.tierDowngraded).toBe(1);
  });

  it("reaps watches left armed on FREE accounts with no live coverage", async () => {
    db.user_tokens.findMany.mockResolvedValue([
      { clerk_user_id: "user_free", email: "free@acme.io" },
    ]);

    const res = await api.get("/cron/deactivate-trials", { headers: AUTH });

    const where = db.user_tokens.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tier: "FREE",
      watch_activated: true,
      deleted_flag: false,
      subscriptions: { none: { status: "active" } },
    });
    expect(res.body.freeDeactivated).toBe(1);
  });

  it("excludes users still covered by an active trial from the reaper", async () => {
    await api.get("/cron/deactivate-trials", { headers: AUTH });

    expect(db.user_tokens.findMany.mock.calls[0][0].where.OR).toEqual([
      { free_trial: null },
      { free_trial: { status: { not: "ACTIVE" } } },
    ]);
  });
});

// ── /archive-messages ────────────────────────────────────────────────────────

describe("POST /api/cron/archive-messages", () => {
  it("only sweeps active rules for live, paying accounts", async () => {
    await api.post("/cron/archive-messages", { headers: AUTH });

    const where = db.archiveRule.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.user_tokens).toMatchObject({
      deleted_flag: false,
      tier: { not: "FREE" },
    });
  });

  it("reports zeroes when there is nothing to sweep", async () => {
    const res = await api.post("/cron/archive-messages", { headers: AUTH });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRules: 0, archivedGmail: 0, failed: 0 });
  });
});

// ── /renew-watch ─────────────────────────────────────────────────────────────

describe("GET /api/cron/renew-watch", () => {
  const coveredOwner = {
    dodoSubscriptionId: "dodo_sub_1",
    customerEmail: "owner@acme.io",
    user_tokens: { clerk_user_id: "user_owner", is_gmail: true },
  };

  beforeEach(() => {
    db.subscription.findMany.mockResolvedValue([]);
    db.organizationMember.findMany.mockResolvedValue([]);
  });

  it("excludes accounts flagged for deletion from every selection", async () => {
    // Re-arming a doomed mailbox just burns provider watch quota.
    db.subscription.findMany.mockResolvedValue([coveredOwner]);

    await api.get("/cron/renew-watch", { headers: AUTH });

    for (const model of [
      db.subscription.findMany,
      db.free_trial.findMany,
      db.organizationMember.findMany,
    ]) {
      expect(model).toHaveBeenCalled();
      for (const call of model.mock.calls) {
        expect(JSON.stringify(call[0].where)).toContain("deleted_flag");
      }
    }
  });

  it("renews only live coverage — active subscriptions and unexpired trials", async () => {
    await api.get("/cron/renew-watch", { headers: AUTH });

    expect(db.subscription.findMany.mock.calls[0][0].where.status).toBe("active");
    const trialWhere = db.free_trial.findMany.mock.calls[0][0].where;
    expect(trialWhere.status).toBe("ACTIVE");
    expect(trialWhere.expires_at.gt).toBeInstanceOf(Date);
  });

  it("also renews active members of a covered owner, who have no row of their own", async () => {
    db.subscription.findMany.mockResolvedValue([coveredOwner]);

    await api.get("/cron/renew-watch", { headers: AUTH });

    const where = db.organizationMember.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ active: true, role: "MEMBER" });
    expect(where.organization.created_by.in).toEqual(["user_owner"]);
  });

  it("skips the member lookup entirely when nobody is covered", async () => {
    await api.get("/cron/renew-watch", { headers: AUTH });

    expect(db.organizationMember.findMany).not.toHaveBeenCalled();
  });

  it("returns 200 with nothing to renew", async () => {
    const res = await api.get("/cron/renew-watch", { headers: AUTH });
    expect(res.status).toBe(200);
  });
});
