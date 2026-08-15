import { beforeEach, describe, expect, it } from "bun:test";

import { resolveSubscriptionStatus } from "@/lib/subscription";
import { db } from "../helpers/prisma-mock";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

interface Fixture {
  subscription?: Record<string, unknown> | null;
  freeTrial?: Record<string, unknown> | null;
  tokens?: Record<string, unknown> | null;
  processingPayment?: boolean;
  zeroPayment?: boolean;
  paidCharge?: boolean;
}

/**
 * resolveSubscriptionStatus fires six queries in one Promise.all, three of them against
 * paymentHistory with different `where` clauses. Routing on that clause keeps each test
 * declarative instead of depending on call order.
 */
function programDb(fixture: Fixture) {
  db.subscription.findFirst.mockResolvedValue(fixture.subscription ?? null);
  db.free_trial.findUnique.mockResolvedValue(fixture.freeTrial ?? null);
  db.user_tokens.findUnique.mockResolvedValue(fixture.tokens ?? null);
  db.paymentHistory.findFirst.mockImplementation(async (args: any) => {
    const where = args.where;
    if (where.status === "processing") {
      return fixture.processingPayment ? { id: "pay_processing" } : null;
    }
    if (where.amount === 0) {
      return fixture.zeroPayment ? { id: "pay_zero" } : null;
    }
    return fixture.paidCharge ? { id: "pay_real" } : null;
  });
}

beforeEach(() => {
  // Solo user by default; the org-resolution path is covered in organization.test.ts.
  db.organizationMember.findUnique.mockResolvedValue(null);
});

describe("no subscription row", () => {
  it("reports unsubscribed when there is no trial either", async () => {
    programDb({ tokens: { tier: "FREE", trial_used: false } });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status).toMatchObject({
      success: false,
      subscribed: false,
      tier: "FREE",
      freeTrial: false,
      extraMailboxes: 0,
    });
  });

  it("reports an active standalone trial as subscribed", async () => {
    programDb({
      tokens: { tier: "MAX", trial_used: true },
      freeTrial: { status: "ACTIVE", expires_at: FUTURE },
    });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status).toMatchObject({
      success: true,
      subscribed: true,
      tier: "MAX",
      status: "trial",
      freeTrial: true,
      next_billing_date: FUTURE,
    });
  });

  it("ignores an expired trial", async () => {
    programDb({
      tokens: { tier: "FREE", trial_used: true },
      freeTrial: { status: "ACTIVE", expires_at: PAST },
    });

    expect((await resolveSubscriptionStatus("user_1")).subscribed).toBe(false);
  });

  it("ignores a cancelled trial that has not expired yet", async () => {
    programDb({
      tokens: { tier: "FREE", trial_used: true },
      freeTrial: { status: "CANCELLED", expires_at: FUTURE },
    });

    expect((await resolveSubscriptionStatus("user_1")).subscribed).toBe(false);
  });
});

describe("paid subscription", () => {
  const activeSubscription = {
    status: "active",
    recurringAmount: 1900,
    currency: "USD",
    paymentFrequencyInterval: "Month",
    paymentFrequencyCount: 1,
    nextBillingDate: FUTURE,
    cancelAtNextBillingDate: false,
    extraMailboxes: 2,
  };

  it("reports an active monthly plan with price in major units", async () => {
    programDb({
      subscription: activeSubscription,
      tokens: { tier: "PRO", trial_used: true },
      paidCharge: true,
    });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status).toMatchObject({
      success: true,
      subscribed: true,
      tier: "PRO",
      status: "active",
      price: 19,
      currency: "USD",
      interval: "monthly",
      extraMailboxes: 2,
      freeTrial: false,
    });
  });

  it("detects annual from Year cadence", async () => {
    programDb({
      subscription: {
        ...activeSubscription,
        paymentFrequencyInterval: "Year",
        paymentFrequencyCount: 1,
      },
      tokens: { tier: "PRO", trial_used: true },
      paidCharge: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).interval).toBe("annual");
  });

  it("detects annual from a 12-month cadence too", async () => {
    programDb({
      subscription: {
        ...activeSubscription,
        paymentFrequencyInterval: "Month",
        paymentFrequencyCount: 12,
      },
      tokens: { tier: "PRO", trial_used: true },
      paidCharge: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).interval).toBe("annual");
  });

  it("reports a cancelled-but-not-yet-expired plan as still subscribed", async () => {
    programDb({
      subscription: { ...activeSubscription, cancelAtNextBillingDate: true },
      tokens: { tier: "PRO", trial_used: true },
      paidCharge: true,
    });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status.subscribed).toBe(true);
    expect(status.cancel_at_next_billing_date).toBe(true);
  });

  it("reports an inactive plan with no covering trial as not subscribed", async () => {
    programDb({
      subscription: { ...activeSubscription, status: "cancelled" },
      tokens: { tier: "FREE", trial_used: true },
      paidCharge: true,
    });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status.subscribed).toBe(false);
    expect(status.status).toBe("cancelled");
  });

  it("prefers a live trial over an inactive subscription row", async () => {
    programDb({
      subscription: { ...activeSubscription, status: "cancelled" },
      freeTrial: { status: "ACTIVE", expires_at: FUTURE },
      tokens: { tier: "MAX", trial_used: true },
    });

    const status = await resolveSubscriptionStatus("user_1");
    expect(status).toMatchObject({
      subscribed: true,
      status: "trial",
      freeTrial: true,
      extraMailboxes: 2,
    });
  });

  it("treats null extraMailboxes as zero seats", async () => {
    programDb({
      subscription: { ...activeSubscription, extraMailboxes: null },
      tokens: { tier: "MAX", trial_used: true },
      paidCharge: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).extraMailboxes).toBe(0);
  });
});

describe("card trial (the $0 charge)", () => {
  const active = {
    status: "active",
    recurringAmount: 3900,
    currency: "USD",
    paymentFrequencyInterval: "Month",
    paymentFrequencyCount: 1,
    nextBillingDate: FUTURE,
    cancelAtNextBillingDate: false,
    extraMailboxes: 0,
  };

  it("flags freeTrial while only the $0 charge exists", async () => {
    programDb({
      subscription: active,
      tokens: { tier: "MAX", trial_used: true },
      zeroPayment: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).freeTrial).toBe(true);
  });

  it("clears freeTrial once a real charge lands", async () => {
    programDb({
      subscription: active,
      tokens: { tier: "MAX", trial_used: true },
      zeroPayment: true,
      paidCharge: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).freeTrial).toBe(false);
  });

  it("does not flag freeTrial when the subscription is no longer active", async () => {
    programDb({
      subscription: { ...active, status: "cancelled" },
      tokens: { tier: "FREE", trial_used: true },
      zeroPayment: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).freeTrial).toBe(false);
  });
});

describe("trialEligible", () => {
  it("is true for a user who has never paid and never used a trial", async () => {
    programDb({ tokens: { tier: "FREE", trial_used: false } });
    expect((await resolveSubscriptionStatus("user_1")).trialEligible).toBe(true);
  });

  it("is false once trial_used is latched", async () => {
    programDb({ tokens: { tier: "FREE", trial_used: true } });
    expect((await resolveSubscriptionStatus("user_1")).trialEligible).toBe(false);
  });

  it("is false after a $0 trial-start charge", async () => {
    programDb({ tokens: { tier: "FREE", trial_used: false }, zeroPayment: true });
    expect((await resolveSubscriptionStatus("user_1")).trialEligible).toBe(false);
  });

  it("is false for a churned direct subscriber who never took a trial", async () => {
    // paid_charge is what catches them: zero_payment alone would let them back in.
    programDb({ tokens: { tier: "FREE", trial_used: false }, paidCharge: true });
    expect((await resolveSubscriptionStatus("user_1")).trialEligible).toBe(false);
  });

  it("is true when the only payment history is an unsuccessful attempt", async () => {
    // programDb answers the succeeded-status probes with null, mirroring a DB that
    // holds only failed/processing rows.
    programDb({ tokens: { tier: "FREE", trial_used: false } });
    expect((await resolveSubscriptionStatus("user_1")).trialEligible).toBe(true);
  });
});

describe("paymentProcessing", () => {
  it("is true while DodoPay reports a payment in flight", async () => {
    programDb({
      tokens: { tier: "FREE", trial_used: false },
      processingPayment: true,
    });

    expect((await resolveSubscriptionStatus("user_1")).paymentProcessing).toBe(true);
  });

  it("is false otherwise", async () => {
    programDb({ tokens: { tier: "FREE", trial_used: false } });
    expect((await resolveSubscriptionStatus("user_1")).paymentProcessing).toBe(false);
  });
});

describe("org resolution", () => {
  it("reads a member's status off the org admin's subscription", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });
    programDb({
      subscription: {
        status: "active",
        recurringAmount: 3900,
        currency: "USD",
        paymentFrequencyInterval: "Month",
        paymentFrequencyCount: 1,
        nextBillingDate: FUTURE,
        cancelAtNextBillingDate: false,
        extraMailboxes: 1,
      },
      tokens: { tier: "MAX", trial_used: true },
      paidCharge: true,
    });

    const status = await resolveSubscriptionStatus("user_member");

    expect(status.subscribed).toBe(true);
    expect(status.tier).toBe("MAX");
    expect(db.subscription.findFirst.mock.calls[0][0].where).toEqual({
      clerkUserId: "user_admin",
    });
  });
});
