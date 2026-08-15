import { beforeEach, describe, expect, it } from "bun:test";

import referral from "@/app/api/[[...route]]/referral";
import { mountRouter } from "../helpers/api";
import { setAuthUser } from "../helpers/clerk-mock";
import { db } from "../helpers/prisma-mock";

const api = mountRouter("/referral", referral);

/** No org membership — the caller bills for themselves and may refer. */
function asBillingOwner(userId = "user_1") {
  setAuthUser(userId);
  db.organizationMember.findUnique.mockResolvedValue(null);
}

/** A non-admin team member: billing (and referrals) belong to `user_admin`. */
function asTeamMember(userId = "user_member") {
  setAuthUser(userId);
  db.organizationMember.findUnique.mockResolvedValue({
    organization: {
      created_by: "user_admin",
      members: [{ user_id: "user_admin" }],
    },
  });
}

describe("GET /api/referral/code", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);

    const res = await api.get("/referral/code");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("403s for a non-admin team member", async () => {
    // A member rides the admin's plan and has no subscription to push forward, so a
    // reward could never be applied — better to refuse the link than hand out a dud.
    asTeamMember();

    const res = await api.get("/referral/code");
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("team admin");
  });

  it("returns the code, share link and remaining months", async () => {
    asBillingOwner();
    db.user_tokens.findUnique.mockResolvedValue({
      referral_code: "ABC23456",
      referral_months_granted: 1,
    });

    const res = await api.get("/referral/code");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code: "ABC23456",
      link: "https://test.neatmail.app/?ref=ABC23456",
      monthsGranted: 1,
      monthsRemaining: 2,
      monthsCap: 3,
    });
  });

  it("reports zero months for a brand-new referrer", async () => {
    asBillingOwner();
    db.user_tokens.findUnique.mockResolvedValue({
      referral_code: "ABC23456",
      referral_months_granted: null,
    });

    const res = await api.get("/referral/code");
    expect(res.body.monthsGranted).toBe(0);
    expect(res.body.monthsRemaining).toBe(3);
  });

  it("clamps remaining months at zero once the cap is reached", async () => {
    asBillingOwner();
    db.user_tokens.findUnique.mockResolvedValue({
      referral_code: "ABC23456",
      referral_months_granted: 5,
    });

    const res = await api.get("/referral/code");
    expect(res.body.monthsRemaining).toBe(0);
  });

  it("mints a code on first load and returns it", async () => {
    asBillingOwner();
    db.user_tokens.findUnique
      .mockResolvedValueOnce({ referral_code: null })
      .mockResolvedValueOnce({ referral_months_granted: 0 });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });

    const res = await api.get("/referral/code");

    expect(res.status).toBe(200);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.body.link).toBe(`https://test.neatmail.app/?ref=${res.body.code}`);
  });
});

describe("GET /api/referral/incoming", () => {
  beforeEach(() => {
    // Nobody shares a team by default.
    db.organization.findUnique.mockResolvedValue(null);
    db.organizationInvite.findMany.mockResolvedValue([]);
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.get("/referral/incoming")).status).toBe(401);
  });

  it("reports referred for a first-time user carrying a valid code cookie", async () => {
    setAuthUser("user_referee");
    db.organizationMember.findUnique.mockResolvedValue(null);
    db.paymentHistory.findFirst.mockResolvedValue(null);
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    const res = await api.get("/referral/incoming", {
      cookies: { nm_ref: "ABC23456" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ referred: true });
  });

  it("reports not referred without a cookie", async () => {
    setAuthUser("user_referee");
    db.paymentHistory.findFirst.mockResolvedValue(null);
    db.referral.findUnique.mockResolvedValue(null);

    expect((await api.get("/referral/incoming")).body).toEqual({ referred: false });
  });

  it("reports not referred once the user has a successful payment", async () => {
    // A returning or churned user must not be shown a promise checkout won't honour.
    setAuthUser("user_returning");
    db.paymentHistory.findFirst.mockResolvedValue({ id: "pay_1" });

    const res = await api.get("/referral/incoming", {
      cookies: { nm_ref: "ABC23456" },
    });

    expect(res.body).toEqual({ referred: false });
    // Short-circuits before touching the referral tables at all.
    expect(db.referral.findUnique).not.toHaveBeenCalled();
  });

  it("only counts succeeded payments, so a declined card keeps the offer alive", async () => {
    setAuthUser("user_referee");
    db.paymentHistory.findFirst.mockResolvedValue(null);
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    const res = await api.get("/referral/incoming", {
      cookies: { nm_ref: "ABC23456" },
    });

    expect(res.body).toEqual({ referred: true });
    expect(db.paymentHistory.findFirst.mock.calls[0][0].where).toEqual({
      clerkUserId: "user_referee",
      status: "succeeded",
    });
  });

  it("reports not referred for a malformed cookie", async () => {
    setAuthUser("user_referee");
    db.paymentHistory.findFirst.mockResolvedValue(null);
    db.referral.findUnique.mockResolvedValue(null);

    const res = await api.get("/referral/incoming", {
      cookies: { nm_ref: "not-a-code" },
    });

    expect(res.body).toEqual({ referred: false });
  });

  it("creates nothing — it is a read-only preview", async () => {
    setAuthUser("user_referee");
    db.paymentHistory.findFirst.mockResolvedValue(null);
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    await api.get("/referral/incoming", { cookies: { nm_ref: "ABC23456" } });

    expect(db.referral.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/referral/status", () => {
  const row = (id: string) => ({
    id,
    status: "PENDING",
    created_at: new Date("2026-08-01T00:00:00.000Z"),
  });
  const CURSOR = "3f1a2b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c";

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.get("/referral/status")).status).toBe(401);
  });

  it("403s for a non-admin team member, same gate as /code", async () => {
    asTeamMember();
    expect((await api.get("/referral/status")).status).toBe(403);
  });

  it("returns the caller's referrals with a null cursor on the last page", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([row("r1"), row("r2")]);

    const res = await api.get("/referral/status");

    expect(res.status).toBe(200);
    expect(res.body.referrals).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
    expect(db.referral.findMany.mock.calls[0][0].where).toEqual({
      referrer_user_id: "user_1",
    });
  });

  it("defaults to 20 per page and over-fetches by one to detect a next page", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([]);

    await api.get("/referral/status");

    expect(db.referral.findMany.mock.calls[0][0].take).toBe(21);
  });

  it("trims the probe row and returns the last real id as the cursor", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([row("r1"), row("r2"), row("r3")]);

    const res = await api.get("/referral/status", { query: { limit: 2 } });

    expect(res.body.referrals.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);
    expect(res.body.nextCursor).toBe("r2");
  });

  it("skips the cursor row itself when paginating", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([]);

    await api.get("/referral/status", { query: { cursor: CURSOR } });

    const args = db.referral.findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: CURSOR });
    expect(args.skip).toBe(1);
  });

  it("orders newest first, tie-broken by id for a stable cursor", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([]);

    await api.get("/referral/status");

    expect(db.referral.findMany.mock.calls[0][0].orderBy).toEqual([
      { created_at: "desc" },
      { id: "desc" },
    ]);
  });

  it("coerces a numeric limit from the query string", async () => {
    asBillingOwner();
    db.referral.findMany.mockResolvedValue([]);

    await api.get("/referral/status", { query: { limit: 5 } });

    expect(db.referral.findMany.mock.calls[0][0].take).toBe(6);
  });

  it("rejects a limit above the maximum", async () => {
    asBillingOwner();
    expect((await api.get("/referral/status", { query: { limit: 500 } })).status).toBe(
      400,
    );
  });

  it("rejects a limit below one, and a non-numeric limit", async () => {
    asBillingOwner();
    expect((await api.get("/referral/status", { query: { limit: 0 } })).status).toBe(400);
    expect(
      (await api.get("/referral/status", { query: { limit: "abc" } })).status,
    ).toBe(400);
  });

  it("rejects a cursor that is not a uuid", async () => {
    asBillingOwner();
    expect(
      (await api.get("/referral/status", { query: { cursor: "r2" } })).status,
    ).toBe(400);
  });

  it("never leaks another user's referrals", async () => {
    asBillingOwner("user_2");
    db.referral.findMany.mockResolvedValue([]);

    await api.get("/referral/status");

    expect(db.referral.findMany.mock.calls[0][0].where.referrer_user_id).toBe("user_2");
  });
});
