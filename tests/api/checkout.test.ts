import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { mountRouter } from "../helpers/api";
import { setAuthUser, setClerkUser } from "../helpers/clerk-mock";
import { db } from "../helpers/prisma-mock";
import {
  dodo,
  failFetch,
  fetchCalls,
  installFetchMock,
  previewResponse,
  restoreFetch,
} from "../helpers/dodo-mock";

/**
 * hasSyncedHistory decides whether checkout returns the customer to /onboard-complete —
 * a page that re-POSTs onboarding answers and wipes existing prefs. Mocked here so each
 * test can state plainly whether this is a first activation.
 */
const hasSyncedHistory = mock(async () => false);
mock.module("@/lib/mailbox-activation", () => ({
  hasSyncedHistory,
  activateMailbox: mock(async () => undefined),
}));

const checkout = (await import("@/app/api/[[...route]]/checkout")).default;
const api = mountRouter("/checkout", checkout);

// The resume / cancel paths call DodoPay's REST API with raw fetch, not the SDK.
installFetchMock();
afterAll(restoreFetch);

const USER = "user_owner";

/** Signed in, self-billed, no org — the default for a paying solo customer. */
function asOwner(userId = USER) {
  setAuthUser(userId);
  setClerkUser(userId, {
    firstName: "Ada",
    lastName: "Lovelace",
    emailAddresses: [{ emailAddress: "ada@acme.io" }],
  });
  db.organizationMember.findUnique.mockResolvedValue(null);
}

/** A non-admin member: every billing mutation must refuse them. */
function asTeamMember(userId = "user_member") {
  setAuthUser(userId);
  db.organizationMember.findUnique.mockResolvedValue({
    organization: {
      created_by: "user_admin",
      members: [{ user_id: "user_admin" }],
    },
  });
}

function activeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_row_1",
    dodoSubscriptionId: "dodo_sub_1",
    dodoCustomerId: "cus_1",
    clerkUserId: USER,
    productId: "pdt_max_monthly_global",
    status: "active",
    cancelAtNextBillingDate: false,
    extraMailboxes: 0,
    paymentFrequencyInterval: "Month",
    paymentFrequencyCount: 1,
    recurringAmount: 3900,
    currency: "USD",
    // Old enough to clear the 30s change cooldown.
    updatedAt: new Date(Date.now() - 60_000),
    nextBillingDate: new Date("2026-09-15T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  hasSyncedHistory.mockClear();
  hasSyncedHistory.mockImplementation(async () => false);
  // No prior payments, no org, nothing pending — each test opts into what it needs.
  db.paymentHistory.findFirst.mockResolvedValue(null);
  db.organization.findUnique.mockResolvedValue(null);
  db.user_tokens.findUnique.mockResolvedValue({ trial_used: false, tier: "FREE" });
  db.subscription.findFirst.mockResolvedValue(null);
  db.referral.findUnique.mockResolvedValue(null);
});

// ── POST /checkout ───────────────────────────────────────────────────────────

describe("POST /api/checkout", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/checkout", { body: { tier: "PRO" } })).status).toBe(401);
  });

  it("403s a team member — they must never mint a second subscription", async () => {
    asTeamMember();

    const res = await api.post("/checkout", { body: { tier: "PRO" } });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("organization admin");
    expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();
  });

  it("creates a session for the requested tier, interval and region", async () => {
    asOwner();

    const res = await api.post("/checkout", {
      body: { tier: "MAX", interval: "annual" },
      headers: { "cf-ipcountry": "IN" },
    });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.test.local/session_1");
    const args = dodo.checkoutSessions.create.mock.calls[0][0];
    expect(args.product_cart).toEqual([{ product_id: "pdt_max_annual_in", quantity: 1 }]);
    expect(args.metadata).toEqual({
      clerk_user_id: USER,
      tier: "MAX",
      interval: "annual",
    });
  });

  it("defaults an unrecognised tier or interval to PRO monthly", async () => {
    asOwner();

    await api.post("/checkout", { body: { tier: "ENTERPRISE", interval: "weekly" } });

    const args = dodo.checkoutSessions.create.mock.calls[0][0];
    expect(args.product_cart[0].product_id).toBe("pdt_pro_monthly_global");
    expect(args.metadata.tier).toBe("PRO");
    expect(args.metadata.interval).toBe("monthly");
  });

  it("passes the Clerk name and email to DodoPay", async () => {
    asOwner();

    await api.post("/checkout", { body: { tier: "PRO" } });

    expect(dodo.checkoutSessions.create.mock.calls[0][0].customer).toEqual({
      email: "ada@acme.io",
      name: "Ada Lovelace",
    });
  });

  describe("trial eligibility", () => {
    it("grants 7 days to a first-time customer", async () => {
      asOwner();

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(7);
    });

    it("grants none once trial_used is latched", async () => {
      asOwner();
      db.user_tokens.findUnique.mockResolvedValue({ trial_used: true });

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(0);
    });

    it("grants none after a prior $0 trial charge", async () => {
      asOwner();
      db.paymentHistory.findFirst.mockImplementation(async (args: any) =>
        args.where.amount === 0 ? { id: "pay_zero" } : null,
      );

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(0);
    });

    it("grants none to a churned direct subscriber who never trialled", async () => {
      asOwner();
      db.paymentHistory.findFirst.mockImplementation(async (args: any) =>
        args.where.amount?.gt === 0 ? { id: "pay_real" } : null,
      );

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(0);
    });

    it("extends to 14 days when a referral cookie is redeemed", async () => {
      asOwner();
      db.user_tokens.findUnique
        .mockResolvedValueOnce({ trial_used: false })
        .mockResolvedValue({ clerk_user_id: "user_referrer" });
      db.organization.findUnique.mockResolvedValue(null);
      db.organizationInvite.findMany.mockResolvedValue([]);

      await api.post("/checkout", {
        body: { tier: "PRO" },
        headers: { "cf-ipcountry": "US" },
        cookies: { nm_ref: "ABC23456" },
      });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(14);
    });

    it("does not extend to 14 when the base trial was already forfeited", async () => {
      // A referral must not resurrect a trial for someone who already used one.
      asOwner();
      db.user_tokens.findUnique.mockResolvedValue({ trial_used: true });

      await api.post("/checkout", {
        body: { tier: "PRO" },
        cookies: { nm_ref: "ABC23456" },
      });

      expect(
        dodo.checkoutSessions.create.mock.calls[0][0].subscription_data
          .trial_period_days,
      ).toBe(0);
    });
  });

  describe("existing subscription guards", () => {
    it("409s when a subscription is already active", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(activeSubscription());

      const res = await api.post("/checkout", { body: { tier: "PRO" } });

      expect(res.status).toBe(409);
      expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();
    });

    it("409s on a pending subscription", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ status: "pending" }),
      );

      expect((await api.post("/checkout", { body: { tier: "PRO" } })).status).toBe(409);
    });

    it("409s while a payment is still processing", async () => {
      asOwner();
      db.paymentHistory.findFirst.mockImplementation(async (args: any) =>
        args.where.status === "processing" ? { id: "pay_processing" } : null,
      );

      expect((await api.post("/checkout", { body: { tier: "PRO" } })).status).toBe(409);
    });

    it("resumes a cancelling subscription instead of creating a second one", async () => {
      // Without this the customer ends up with two subscriptions billing in parallel.
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ cancelAtNextBillingDate: true }),
      );

      const res = await api.post("/checkout", { body: { tier: "PRO" } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, resumed: true });
      expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();

      const call = fetchCalls.at(-1)!;
      expect(call.method).toBe("PATCH");
      expect(call.url).toContain("/subscriptions/dodo_sub_1");
      expect(call.body).toEqual({ cancel_at_next_billing_date: false });
    });

    it("502s rather than double-subscribing when the resume call fails", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ cancelAtNextBillingDate: true }),
      );
      failFetch(500);

      const res = await api.post("/checkout", { body: { tier: "PRO" } });

      expect(res.status).toBe(502);
      expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();
    });

    it("sends an on_hold customer to update their payment method", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ status: "on_hold" }),
      );

      const res = await api.post("/checkout", { body: { tier: "PRO" } });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe("https://checkout.test.local/update-method");
      expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();
    });
  });

  describe("seat cap", () => {
    it("409s when the team is larger than the target plan allows", async () => {
      // Re-subscribing to PRO while a MAX teammate's row survived cancellation.
      asOwner();
      db.organization.findUnique.mockResolvedValue({ _count: { members: 2 } });

      const res = await api.post("/checkout", { body: { tier: "PRO" } });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TEAM_OVER_SEAT_CAP");
      expect(res.body.memberCount).toBe(2);
      expect(dodo.checkoutSessions.create).not.toHaveBeenCalled();
    });

    it("allows a MAX subscribe that exactly fills the cap", async () => {
      asOwner();
      db.organization.findUnique.mockResolvedValue({ _count: { members: 1 } });

      expect((await api.post("/checkout", { body: { tier: "MAX" } })).status).toBe(200);
    });

    it("counts paid add-on seats toward the cap", async () => {
      asOwner();
      db.organization.findUnique.mockResolvedValue({ _count: { members: 3 } });
      db.subscription.findFirst.mockResolvedValue(null);
      // getExtraMailboxes reads the owner's active subscription separately.
      db.subscription.findFirst.mockImplementation(async (args: any) =>
        args.where.status === "active" ? { extraMailboxes: 2 } : null,
      );

      expect((await api.post("/checkout", { body: { tier: "MAX" } })).status).toBe(200);
    });
  });

  describe("return url", () => {
    it("routes a genuine first activation to /onboard-complete", async () => {
      asOwner();
      hasSyncedHistory.mockImplementation(async () => false);

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(dodo.checkoutSessions.create.mock.calls[0][0].return_url).toBe(
        "https://test.neatmail.app/onboard-complete",
      );
    });

    it("keeps a returning customer away from it, even with an empty mailbox", async () => {
      // /onboard-complete re-POSTs onboarding answers and wipes existing prefs.
      asOwner();
      hasSyncedHistory.mockImplementation(async () => false);
      db.paymentHistory.findFirst.mockImplementation(async (args: any) =>
        args.where.amount?.gt === 0 ? { id: "pay_real" } : null,
      );

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(dodo.checkoutSessions.create.mock.calls[0][0].return_url).toBe(
        "https://test.neatmail.app",
      );
    });

    it("keeps a synced mailbox away from it too", async () => {
      asOwner();
      hasSyncedHistory.mockImplementation(async () => true);

      await api.post("/checkout", { body: { tier: "PRO" } });

      expect(dodo.checkoutSessions.create.mock.calls[0][0].return_url).toBe(
        "https://test.neatmail.app",
      );
    });
  });

  it("500s when no product is configured for the region", async () => {
    asOwner();
    const key = "DODO_PRODUCT_ID_PRO_MONTHLY_GLOBAL";
    const original = process.env[key];
    delete process.env[key];
    try {
      const res = await api.post("/checkout", { body: { tier: "PRO" } });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Payment configuration error");
    } finally {
      process.env[key] = original;
    }
  });

  it("500s without leaking the SDK error when DodoPay throws", async () => {
    asOwner();
    dodo.checkoutSessions.create.mockRejectedValue(new Error("dodo down"));

    const res = await api.post("/checkout", { body: { tier: "PRO" } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create checkout session" });
  });
});

// ── POST /checkout/cancelSubscription ────────────────────────────────────────

describe("POST /api/checkout/cancelSubscription", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/checkout/cancelSubscription")).status).toBe(401);
  });

  it("403s a team member", async () => {
    asTeamMember();
    expect((await api.post("/checkout/cancelSubscription")).status).toBe(403);
  });

  it("schedules cancellation at the end of the period", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/cancelSubscription");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fetchCalls.at(-1)!.body).toEqual({ cancel_at_next_billing_date: false });
  });

  it("re-enables cancellation when renew=true", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    await api.post("/checkout/cancelSubscription", { query: { renew: "true" } });

    expect(fetchCalls.at(-1)!.body).toEqual({ cancel_at_next_billing_date: true });
  });

  it("409s with nothing to cancel", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);

    expect((await api.post("/checkout/cancelSubscription")).status).toBe(409);
  });

  it("opens a fresh checkout when renew=false and the subscription is gone", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });

    const res = await api.post("/checkout/cancelSubscription", {
      query: { renew: "false" },
      headers: { "cf-ipcountry": "IN" },
    });

    expect(res.status).toBe(200);
    expect(res.body.redirect).toBe(true);
    const args = dodo.checkoutSessions.create.mock.calls[0][0];
    expect(args.product_cart[0].product_id).toBe("pdt_max_monthly_in");
    // A re-subscribe is never a fresh trial.
    expect(args.subscription_data.trial_period_days).toBe(0);
  });

  it("400s on renew=false for a user with no tier to renew", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ tier: "FREE" });

    const res = await api.post("/checkout/cancelSubscription", {
      query: { renew: "false" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No subscription to renew");
  });

  it("500s when the DodoPay call fails", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    failFetch(500);

    expect((await api.post("/checkout/cancelSubscription")).status).toBe(500);
  });
});

// ── POST /checkout/changePlan ────────────────────────────────────────────────

describe("POST /api/checkout/changePlan", () => {
  beforeEach(() => {
    db.user_tokens.findUnique.mockResolvedValue({ tier: "PRO" });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/checkout/changePlan", { body: { tier: "MAX" } })).status).toBe(
      401,
    );
  });

  it("403s a team member — plan changes write user_tokens.tier", async () => {
    asTeamMember();
    expect((await api.post("/checkout/changePlan", { body: { tier: "MAX" } })).status).toBe(
      403,
    );
  });

  it("400s with no active subscription", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);

    expect((await api.post("/checkout/changePlan", { body: { tier: "MAX" } })).status).toBe(
      400,
    );
  });

  it("upgrades and propagates the tier to the whole billing team", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ productId: "pdt_pro_monthly_global" }),
    );
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: USER }, { user_id: "user_member" }],
    });

    const res = await api.post("/checkout/changePlan", { body: { tier: "MAX" } });

    expect(res.status).toBe(200);
    expect(dodo.subscriptions.changePlan.mock.calls[0][1]).toMatchObject({
      product_id: "pdt_max_monthly_global",
      proration_billing_mode: "difference_immediately",
      quantity: 1,
    });
    const update = db.user_tokens.updateMany.mock.calls[0][0];
    expect(update.data).toEqual({ tier: "MAX" });
    expect(update.where.clerk_user_id.in).toContain("user_member");
  });

  it("mirrors the new plan locally so an add-on call can't revert it", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    await api.post("/checkout/changePlan", {
      body: { tier: "MAX", interval: "annual" },
    });

    expect(db.subscription.update.mock.calls[0][0].data).toEqual({
      productId: "pdt_max_annual_global",
      paymentFrequencyInterval: "Year",
      paymentFrequencyCount: 1,
    });
  });

  it("409s when already on the requested plan and cadence", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/changePlan", {
      body: { tier: "MAX", interval: "monthly" },
    });

    expect(res.status).toBe(409);
    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("allows a cadence switch on the same tier", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/changePlan", {
      body: { tier: "MAX", interval: "annual" },
    });

    expect(res.status).toBe(200);
  });

  it("429s inside the 30s cooldown", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ updatedAt: new Date(Date.now() - 5_000) }),
    );

    const res = await api.post("/checkout/changePlan", { body: { tier: "MAX" } });

    expect(res.status).toBe(429);
    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("refuses a downgrade that would strand paid mailboxes", async () => {
    // The seats are paid for; cancelling them is the owner's call, not a side effect.
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    const res = await api.post("/checkout/changePlan", { body: { tier: "PRO" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAILBOXES_NOT_ON_TARGET_TIER");
    expect(res.body.extraMailboxes).toBe(2);
    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("refuses a downgrade the current team can't fit into", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    db.organization.findUnique.mockResolvedValue({ _count: { members: 1 } });

    const res = await api.post("/checkout/changePlan", { body: { tier: "PRO" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TEAM_OVER_SEAT_CAP");
  });

  it("re-sends paid mailboxes so the SDK doesn't silently wipe them", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 3 }),
    );

    await api.post("/checkout/changePlan", {
      body: { tier: "MAX", interval: "annual" },
      headers: { "cf-ipcountry": "IN" },
    });

    // Resolved against the TARGET interval and the caller's region — an add-on's
    // billing cycle must match the plan it is attached to.
    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([
      { addon_id: "addon_mbx_annual_in", quantity: 3 },
    ]);
  });

  it("sends an empty add-on cart when there are no paid mailboxes", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    await api.post("/checkout/changePlan", { body: { tier: "MAX" } });

    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([]);
  });

  it("500s when the target region has no add-on product configured", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 1 }),
    );
    const key = "DODO_ADDON_MAILBOX_ANNUAL_GLOBAL";
    const original = process.env[key];
    delete process.env[key];
    try {
      const res = await api.post("/checkout/changePlan", {
        body: { tier: "MAX", interval: "annual" },
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("mailbox add-on");
      expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
    } finally {
      process.env[key] = original;
    }
  });
});

// ── POST /checkout/preview ───────────────────────────────────────────────────

describe("POST /api/checkout/preview", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/checkout/preview", { body: { tier: "MAX" } })).status).toBe(
      401,
    );
  });

  it("400s with no active subscription", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);

    expect((await api.post("/checkout/preview", { body: { tier: "MAX" } })).status).toBe(
      400,
    );
  });

  it("returns the recurring total from new_plan, add-ons already included", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    dodo.subscriptions.previewChangePlan.mockResolvedValue(
      previewResponse({
        summary: { total_amount: 0, customer_credits: -1710, currency: "USD" },
        new_plan: { recurring_pre_tax_amount: 2500, currency: "USD" },
      }),
    );

    const res = await api.post("/checkout/preview", { body: { tier: "MAX" } });

    expect(res.status).toBe(200);
    // 2500 is the full recurring total (1500 plan + 1000 seat) — never summed from
    // line_items, which double-count the plan.
    expect(res.body.newPlan.recurringAmount).toBe(2500);
    expect(res.body.summary.customerCredits).toBe(-1710);
  });

  it("keeps the two currencies apart under Adaptive Currency", async () => {
    // The immediate charge can be presented in ₹ while the plan stays USD-denominated;
    // labelling the plan with the summary's currency renders $6.74 as "₹6.74".
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    dodo.subscriptions.previewChangePlan.mockResolvedValue(
      previewResponse({
        summary: { total_amount: 56000, currency: "INR" },
        new_plan: { recurring_pre_tax_amount: 674, currency: "USD" },
      }),
    );

    const res = await api.post("/checkout/preview", { body: { tier: "MAX" } });

    expect(res.body.summary.currency).toBe("INR");
    expect(res.body.newPlan.currency).toBe("USD");
  });

  it("reports an annual cadence from either representation", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    for (const plan of [
      { payment_frequency_interval: "Year", payment_frequency_count: 1 },
      { payment_frequency_interval: "Month", payment_frequency_count: 12 },
    ]) {
      dodo.subscriptions.previewChangePlan.mockResolvedValue(
        previewResponse({ new_plan: plan }),
      );
      const res = await api.post("/checkout/preview", { body: { tier: "MAX" } });
      expect(res.body.newPlan.interval).toBe("year");
    }
  });

  it("mirrors changePlan's refusal so the dialog can't quote a blocked change", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    const res = await api.post("/checkout/preview", { body: { tier: "PRO" } });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MAILBOXES_NOT_ON_TARGET_TIER");
    expect(dodo.subscriptions.previewChangePlan).not.toHaveBeenCalled();
  });

  it("previews the same cart changePlan would commit", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    await api.post("/checkout/preview", {
      body: { tier: "MAX", interval: "annual" },
      headers: { "cf-ipcountry": "IN" },
    });

    expect(dodo.subscriptions.previewChangePlan.mock.calls[0][1]).toMatchObject({
      product_id: "pdt_max_annual_in",
      proration_billing_mode: "difference_immediately",
      addons: [{ addon_id: "addon_mbx_annual_in", quantity: 2 }],
    });
  });
});

// ── POST /checkout/mailboxes ─────────────────────────────────────────────────

describe("POST /api/checkout/mailboxes", () => {
  beforeEach(() => {
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX", trial_used: true });
    db.free_trial.findUnique.mockResolvedValue(null);
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.post("/checkout/mailboxes", { body: { count: 1 } })).status).toBe(
      401,
    );
  });

  it("403s a team member", async () => {
    asTeamMember();
    expect((await api.post("/checkout/mailboxes", { body: { count: 1 } })).status).toBe(
      403,
    );
  });

  it("400s on a count that isn't a whole number in range", async () => {
    asOwner();

    for (const count of [-1, 1.5, 51, "2", null, undefined]) {
      const res = await api.post("/checkout/mailboxes", { body: { count } });
      expect(res.status).toBe(400);
    }
    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("400s without an active subscription", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);

    expect((await api.post("/checkout/mailboxes", { body: { count: 1 } })).status).toBe(
      400,
    );
  });

  it("refuses during a card trial — a proration would end the trial early", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    // resolveSubscriptionStatus reads a $0 succeeded payment with no real charge.
    db.paymentHistory.findFirst.mockImplementation(async (args: any) =>
      args.where.amount === 0 ? { id: "pay_zero" } : null,
    );

    const res = await api.post("/checkout/mailboxes", { body: { count: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("once your subscription starts");
    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("403s buying seats on PRO", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "PRO", trial_used: true });
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/mailboxes", { body: { count: 2 } });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAILBOXES_NOT_ON_TIER");
  });

  it("still allows REDUCING seats on PRO, so nobody is trapped paying", async () => {
    // A subscription downgraded out-of-band can hold add-ons it can no longer use.
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "PRO", trial_used: true });
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    const res = await api.post("/checkout/mailboxes", { body: { count: 0 } });

    expect(res.status).toBe(200);
    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([]);
  });

  it("409s when the count already matches", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    expect((await api.post("/checkout/mailboxes", { body: { count: 2 } })).status).toBe(
      409,
    );
  });

  it("429s inside the 30s cooldown", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ updatedAt: new Date(Date.now() - 5_000) }),
    );

    expect((await api.post("/checkout/mailboxes", { body: { count: 1 } })).status).toBe(
      429,
    );
  });

  it("buys seats with immediate proration and prevent_change", async () => {
    // prevent_change is what keeps money and seats in lockstep: no payment, no seats.
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/mailboxes", { body: { count: 2 } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, count: 2 });
    expect(dodo.subscriptions.changePlan.mock.calls[0][1]).toMatchObject({
      product_id: "pdt_max_monthly_global",
      proration_billing_mode: "prorated_immediately",
      on_payment_failure: "prevent_change",
      addons: [{ addon_id: "addon_mbx_monthly_global", quantity: 2 }],
    });
  });

  it("resolves the add-on from the plan's own product, not the browsing country", async () => {
    // The base plan is not changing here, so the add-on must match the product the
    // customer already holds — an Indian customer travelling must not get a GLOBAL seat.
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ productId: "pdt_max_annual_in" }),
    );

    await api.post("/checkout/mailboxes", {
      body: { count: 1 },
      headers: { "cf-ipcountry": "US" },
    });

    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([
      { addon_id: "addon_mbx_annual_in", quantity: 1 },
    ]);
  });

  it("falls back to cf-ipcountry for an unrecognised product id", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({
        productId: "pdt_grandfathered",
        paymentFrequencyInterval: "Year",
        paymentFrequencyCount: 1,
      }),
    );

    await api.post("/checkout/mailboxes", {
      body: { count: 1 },
      headers: { "cf-ipcountry": "IN" },
    });

    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([
      { addon_id: "addon_mbx_annual_in", quantity: 1 },
    ]);
  });

  it("does not write extraMailboxes locally — the webhook owns that", async () => {
    // Under prevent_change the webhook only lands once the charge settles, so the
    // seat count can never run ahead of the money.
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    await api.post("/checkout/mailboxes", { body: { count: 2 } });

    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  describe("removal with occupied seats", () => {
    it("409s when the reduction would strip a live seat", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ extraMailboxes: 3 }),
      );
      db.organization.findUnique.mockResolvedValue({ id: "org_1" });
      db.organizationMember.count.mockResolvedValue(3);
      db.organizationInvite.count.mockResolvedValue(0);

      const res = await api.post("/checkout/mailboxes", { body: { count: 0 } });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("MAILBOX_SEATS_IN_USE");
      expect(res.body.occupied).toBe(3);
    });

    it("counts still-open invites as occupied", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ extraMailboxes: 3 }),
      );
      db.organization.findUnique.mockResolvedValue({ id: "org_1" });
      db.organizationMember.count.mockResolvedValue(1);
      db.organizationInvite.count.mockResolvedValue(2);

      const res = await api.post("/checkout/mailboxes", { body: { count: 0 } });

      expect(res.status).toBe(409);
      expect(res.body.occupied).toBe(3);
    });

    it("allows a reduction that still covers everyone", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ extraMailboxes: 3 }),
      );
      db.organization.findUnique.mockResolvedValue({ id: "org_1" });
      db.organizationMember.count.mockResolvedValue(1);
      db.organizationInvite.count.mockResolvedValue(0);

      // MAX includes 1 seat, plus 1 paid = 2 ≥ 1 occupied.
      expect(
        (await api.post("/checkout/mailboxes", { body: { count: 1 } })).status,
      ).toBe(200);
    });

    it("never blocks an increase on the occupied-seat check", async () => {
      asOwner();
      db.subscription.findFirst.mockResolvedValue(
        activeSubscription({ extraMailboxes: 1 }),
      );
      db.organizationMember.count.mockResolvedValue(5);

      expect(
        (await api.post("/checkout/mailboxes", { body: { count: 4 } })).status,
      ).toBe(200);
    });
  });

  it("500s when the add-on product is unconfigured", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    const key = "DODO_ADDON_MAILBOX_MONTHLY_GLOBAL";
    const original = process.env[key];
    delete process.env[key];
    try {
      const res = await api.post("/checkout/mailboxes", { body: { count: 1 } });
      expect(res.status).toBe(500);
      expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
    } finally {
      process.env[key] = original;
    }
  });
});

// ── POST /checkout/mailboxes/preview ─────────────────────────────────────────

describe("POST /api/checkout/mailboxes/preview", () => {
  beforeEach(() => {
    db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX", trial_used: true });
  });

  it("401s when signed out", async () => {
    setAuthUser(null);
    expect(
      (await api.post("/checkout/mailboxes/preview", { body: { count: 1 } })).status,
    ).toBe(401);
  });

  it("403s a team member", async () => {
    asTeamMember();
    expect(
      (await api.post("/checkout/mailboxes/preview", { body: { count: 1 } })).status,
    ).toBe(403);
  });

  it("400s on an out-of-range count", async () => {
    asOwner();
    expect(
      (await api.post("/checkout/mailboxes/preview", { body: { count: 99 } })).status,
    ).toBe(400);
  });

  it("403s previewing a purchase PRO can't make", async () => {
    asOwner();
    db.user_tokens.findUnique.mockResolvedValue({ tier: "PRO" });
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    const res = await api.post("/checkout/mailboxes/preview", { body: { count: 1 } });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAILBOXES_NOT_ON_TIER");
  });

  it("quotes DodoPay's own net total rather than summing line items", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 1 }),
    );
    dodo.subscriptions.previewChangePlan.mockResolvedValue(
      previewResponse({
        summary: {
          total_amount: 674,
          customer_credits: -1710,
          tax: 121,
          currency: "USD",
        },
        new_plan: { recurring_pre_tax_amount: 4900, currency: "USD" },
      }),
    );

    const res = await api.post("/checkout/mailboxes/preview", { body: { count: 2 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      count: 2,
      currentCount: 1,
      chargedNow: 674,
      credits: -1710,
      tax: 121,
      newRecurring: 4900,
      annual: false,
    });
  });

  it("keeps presentment and plan currency separate", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());
    dodo.subscriptions.previewChangePlan.mockResolvedValue(
      previewResponse({
        summary: { total_amount: 56000, currency: "INR" },
        new_plan: { recurring_pre_tax_amount: 674, currency: "USD" },
      }),
    );

    const res = await api.post("/checkout/mailboxes/preview", { body: { count: 1 } });

    expect(res.body.currency).toBe("INR");
    expect(res.body.recurringCurrency).toBe("USD");
  });

  it("reports the annual flag from the plan's product", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ productId: "pdt_max_annual_in" }),
    );

    const res = await api.post("/checkout/mailboxes/preview", { body: { count: 1 } });

    expect(res.body.annual).toBe(true);
  });

  it("previews a removal as an empty cart", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(
      activeSubscription({ extraMailboxes: 2 }),
    );

    await api.post("/checkout/mailboxes/preview", { body: { count: 0 } });

    expect(dodo.subscriptions.previewChangePlan.mock.calls[0][1].addons).toEqual([]);
  });

  it("previews against the unchanged base plan", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(activeSubscription());

    await api.post("/checkout/mailboxes/preview", { body: { count: 1 } });

    expect(dodo.subscriptions.previewChangePlan.mock.calls[0][1]).toMatchObject({
      product_id: "pdt_max_monthly_global",
      proration_billing_mode: "prorated_immediately",
    });
  });
});

// ── GET /checkout/invoice/:id and /portal ────────────────────────────────────

describe("GET /api/checkout/invoice/:id", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.get("/checkout/invoice/pay_1")).status).toBe(401);
  });

  it("401s when the invoice belongs to another user", async () => {
    asOwner();
    db.paymentHistory.findUnique.mockResolvedValue({
      dodoPaymentId: "pay_1",
      clerkUserId: "user_someone_else",
    });

    const res = await api.get("/checkout/invoice/pay_1");

    expect(res.status).toBe(401);
    expect(dodo.invoices.payments.retrieve).not.toHaveBeenCalled();
  });

  it("returns the PDF with download headers", async () => {
    asOwner();
    db.paymentHistory.findUnique.mockResolvedValue({
      dodoPaymentId: "pay_1",
      clerkUserId: USER,
    });

    const res = await api.get("/checkout/invoice/pay_1");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("invoice-pay_1.pdf");
  });

  it("500s for an unknown payment id", async () => {
    asOwner();
    db.paymentHistory.findUnique.mockResolvedValue(null);

    expect((await api.get("/checkout/invoice/pay_missing")).status).toBe(500);
  });
});

describe("GET /api/checkout/portal", () => {
  it("401s when signed out", async () => {
    setAuthUser(null);
    expect((await api.get("/checkout/portal")).status).toBe(401);
  });

  it("returns a portal link for a known customer", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue({ dodoCustomerId: "cus_1" });

    const res = await api.get("/checkout/portal");

    expect(res.status).toBe(200);
    expect(res.body.data).toBe("https://portal.test.local/customer_1");
  });

  it("falls back to the customer id on payment history", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);
    db.paymentHistory.findFirst.mockResolvedValue({
      subscription: { dodoCustomerId: "cus_from_payment" },
    });

    const res = await api.get("/checkout/portal");

    expect(res.status).toBe(200);
    expect(dodo.customers.customerPortal.create).toHaveBeenCalledWith(
      "cus_from_payment",
    );
  });

  it("returns an empty string for a user who never paid", async () => {
    asOwner();
    db.subscription.findFirst.mockResolvedValue(null);
    db.paymentHistory.findFirst.mockResolvedValue(null);

    const res = await api.get("/checkout/portal");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "" });
    expect(dodo.customers.customerPortal.create).not.toHaveBeenCalled();
  });
});
