import { beforeEach, describe, expect, it } from "bun:test";

import {
  MAX_REFERRAL_MONTHS,
  REFERRAL_CODE_PATTERN,
  getOrCreateReferralCode,
  isReferralRedeemable,
  maybeRewardReferral,
  redeemReferralCookie,
} from "@/lib/referral";
import { db, uniqueConstraintError } from "../helpers/prisma-mock";
import { registerLuaScript } from "../helpers/redis-mock";
import { dodo } from "../helpers/dodo-mock";

/**
 * lib/referral.ts reaches into the checkout route for its DodoPay client. The route is
 * NOT mocked here: the `dodopayments` SDK is already replaced globally in setup.ts, so
 * the real `getDodoPayments()` hands back the shared double. Mocking the checkout module
 * locally would leak into tests/unit/payement.test.ts, which needs `changePlan` off the
 * same client.
 */
const subscriptionsUpdate = dodo.subscriptions.update;

/** No shared org between any pair, unless a test says otherwise. */
function noSharedTeams() {
  db.organization.findUnique.mockResolvedValue(null);
  db.organizationMember.findUnique.mockResolvedValue(null);
  db.organizationInvite.findMany.mockResolvedValue([]);
}

/** Both users resolve to the same org, so haveEverSharedTeam is true. */
function sharedTeam(orgId = "org_1") {
  db.organization.findUnique.mockResolvedValue({ id: orgId });
  db.organizationMember.findUnique.mockResolvedValue({ organization_id: orgId });
  db.organizationInvite.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  // The shared DodoPay double is reset globally; this only re-states the local alias.
  noSharedTeams();
  // lib/redis.ts releases the referrer lock with a compare-and-delete Lua script.
  registerLuaScript('if redis.call("get", KEYS[1]) == ARGV[1]', async (redis, keys, argv) => {
    if ((await redis.get(keys[0])) === argv[0]) return redis.del(keys[0]);
    return 0;
  });
});

describe("REFERRAL_CODE_PATTERN", () => {
  it("accepts 6–10 uppercase alphanumerics", () => {
    for (const code of ["ABC234", "ABCDEFGHJK", "AB2C3D4E"]) {
      expect(REFERRAL_CODE_PATTERN.test(code)).toBe(true);
    }
  });

  it("rejects anything shorter, longer, lowercase or punctuated", () => {
    for (const code of ["ABC23", "ABCDEFGHJKL", "abc234", "ABC-23", "ABC 234", ""]) {
      expect(REFERRAL_CODE_PATTERN.test(code)).toBe(false);
    }
  });
});

describe("getOrCreateReferralCode", () => {
  it("returns the existing code without minting a new one", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: "ABC23456" });

    expect(await getOrCreateReferralCode("user_1")).toBe("ABC23456");
    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
  });

  it("mints a code matching the shareable format when there is none", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: null });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });

    const code = await getOrCreateReferralCode("user_1");

    expect(code).toHaveLength(8);
    expect(REFERRAL_CODE_PATTERN.test(code)).toBe(true);
    // 0/O/1/I/L are excluded so codes survive being read aloud.
    expect(code).not.toMatch(/[01OIL]/);
  });

  it("writes conditionally, so a concurrent first load cannot clobber the winner", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: null });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });

    await getOrCreateReferralCode("user_1");

    expect(db.user_tokens.updateMany.mock.calls[0][0].where).toEqual({
      clerk_user_id: "user_1",
      referral_code: null,
    });
  });

  it("reads back the winner's code when it loses the race", async () => {
    db.user_tokens.findUnique
      .mockResolvedValueOnce({ referral_code: null })
      .mockResolvedValueOnce({ referral_code: "WINNER22" });
    db.user_tokens.updateMany.mockResolvedValue({ count: 0 });

    expect(await getOrCreateReferralCode("user_1")).toBe("WINNER22");
  });

  it("retries with a fresh candidate after a code collision", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: null });
    db.user_tokens.updateMany
      .mockRejectedValueOnce(uniqueConstraintError("referral_code"))
      .mockResolvedValueOnce({ count: 1 });

    const code = await getOrCreateReferralCode("user_1");

    expect(REFERRAL_CODE_PATTERN.test(code)).toBe(true);
    expect(db.user_tokens.updateMany).toHaveBeenCalledTimes(2);
  });

  it("gives up after three collisions instead of looping forever", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: null });
    db.user_tokens.updateMany.mockRejectedValue(uniqueConstraintError("referral_code"));

    expect(getOrCreateReferralCode("user_1")).rejects.toThrow(
      "Failed to generate a unique referral code",
    );
  });

  it("rethrows a non-P2002 database error rather than retrying", async () => {
    db.user_tokens.findUnique.mockResolvedValue({ referral_code: null });
    db.user_tokens.updateMany.mockRejectedValue(new Error("connection lost"));

    expect(getOrCreateReferralCode("user_1")).rejects.toThrow("connection lost");
  });
});

describe("isReferralRedeemable", () => {
  it("is true for a valid code from another user", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    expect(await isReferralRedeemable("user_referee", "ABC23456")).toBe(true);
  });

  it("normalises a lowercase, padded cookie before looking it up", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    expect(await isReferralRedeemable("user_referee", "  abc23456  ")).toBe(true);
    expect(db.user_tokens.findUnique.mock.calls[0][0].where).toEqual({
      referral_code: "ABC23456",
    });
  });

  it("is false with no code at all", async () => {
    db.referral.findUnique.mockResolvedValue(null);

    expect(await isReferralRedeemable("user_referee", undefined)).toBe(false);
    expect(await isReferralRedeemable("user_referee", null)).toBe(false);
    expect(await isReferralRedeemable("user_referee", "")).toBe(false);
  });

  it("is false for a malformed code, without hitting the database", async () => {
    db.referral.findUnique.mockResolvedValue(null);

    expect(await isReferralRedeemable("user_referee", "nope!")).toBe(false);
    expect(db.user_tokens.findUnique).not.toHaveBeenCalled();
  });

  it("is false for a well-formed code that resolves to nobody", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue(null);

    expect(await isReferralRedeemable("user_referee", "ZZZ99999")).toBe(false);
  });

  it("is false for a self-referral", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referee" });

    expect(await isReferralRedeemable("user_referee", "ABC23456")).toBe(false);
  });

  it("is false between users who were ever on the same team", async () => {
    // A member already gets premium free via the admin's plan — rewarding either
    // for the other is circular, not a new customer.
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_admin" });
    sharedTeam();

    expect(await isReferralRedeemable("user_member", "ABC23456")).toBe(false);
  });

  it("stays true for an abandoned checkout still sitting at PENDING", async () => {
    db.referral.findUnique.mockResolvedValue({ status: "PENDING" });

    expect(await isReferralRedeemable("user_referee", undefined)).toBe(true);
  });

  it("is false once the redemption has been spent", async () => {
    for (const status of ["REWARDED", "CAPPED", "REVOKED"]) {
      db.referral.findUnique.mockResolvedValue({ status });
      expect(await isReferralRedeemable("user_referee", "ABC23456")).toBe(false);
    }
  });
});

describe("redeemReferralCookie", () => {
  it("creates a PENDING referral for a valid code", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });

    expect(await redeemReferralCookie("user_referee", "abc23456")).toBe(true);
    expect(db.referral.create.mock.calls[0][0].data).toEqual({
      referrer_user_id: "user_referrer",
      referee_user_id: "user_referee",
      referral_code: "ABC23456",
      status: "PENDING",
    });
  });

  it("reuses an existing PENDING row instead of creating a second one", async () => {
    db.referral.findUnique.mockResolvedValue({ status: "PENDING" });

    expect(await redeemReferralCookie("user_referee", "ABC23456")).toBe(true);
    expect(db.referral.create).not.toHaveBeenCalled();
  });

  it("refuses a second redemption once the first was rewarded", async () => {
    db.referral.findUnique.mockResolvedValue({ status: "REWARDED" });

    expect(await redeemReferralCookie("user_referee", "ABC23456")).toBe(false);
  });

  it("creates nothing for an invalid code, and never throws into checkout", async () => {
    db.referral.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue(null);

    expect(await redeemReferralCookie("user_referee", "ZZZ99999")).toBe(false);
    expect(db.referral.create).not.toHaveBeenCalled();
  });

  it("accepts the concurrent winner's row when it loses a create race", async () => {
    db.referral.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "PENDING" });
    db.user_tokens.findUnique.mockResolvedValue({ clerk_user_id: "user_referrer" });
    db.referral.create.mockRejectedValue(uniqueConstraintError("referee_user_id"));

    expect(await redeemReferralCookie("user_referee", "ABC23456")).toBe(true);
  });
});

describe("maybeRewardReferral", () => {
  const payload = (overrides: Record<string, unknown> = {}) =>
    ({
      data: {
        total_amount: 1900,
        metadata: { clerk_user_id: "user_referee" },
        ...overrides,
      },
    }) as never;

  const pendingReferral = {
    id: "ref_1",
    referrer_user_id: "user_referrer",
    referee_user_id: "user_referee",
    status: "PENDING",
  };

  const activeSubscription = {
    id: "sub_1",
    dodoSubscriptionId: "dodo_sub_1",
    status: "active",
    cancelAtNextBillingDate: false,
    nextBillingDate: new Date("2026-09-01T00:00:00.000Z"),
  };

  it("ignores the $0 trial-start charge — it is not a conversion", async () => {
    await maybeRewardReferral(payload({ total_amount: 0 }));
    expect(db.referral.findFirst).not.toHaveBeenCalled();
  });

  it("ignores a payment carrying no clerk user id", async () => {
    await maybeRewardReferral(payload({ metadata: {} }));
    expect(db.referral.findFirst).not.toHaveBeenCalled();
  });

  it("does nothing when the payer has no pending referral", async () => {
    db.referral.findFirst.mockResolvedValue(null);

    await maybeRewardReferral(payload());

    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("pushes the referrer's billing date out by one month and marks it REWARDED", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(activeSubscription);
    db.paymentHistory.findFirst.mockResolvedValue({ id: "pay_1" });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });
    db.user_tokens.findUnique.mockResolvedValue({
      email: "referrer@example.com",
      referral_months_granted: 1,
    });

    await maybeRewardReferral(payload());

    expect(subscriptionsUpdate).toHaveBeenCalledWith("dodo_sub_1", {
      next_billing_date: "2026-10-01T00:00:00.000Z",
    });
    const statuses = db.referral.update.mock.calls.map((c: any[]) => c[0].data.status);
    expect(statuses).toContain("REWARDED");
  });

  it("reserves the cap slot atomically, only below the maximum", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(activeSubscription);
    db.paymentHistory.findFirst.mockResolvedValue({ id: "pay_1" });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });
    db.user_tokens.findUnique.mockResolvedValue({
      email: "referrer@example.com",
      referral_months_granted: 1,
    });

    await maybeRewardReferral(payload());

    expect(db.user_tokens.updateMany.mock.calls[0][0]).toEqual({
      where: {
        clerk_user_id: "user_referrer",
        referral_months_granted: { lt: MAX_REFERRAL_MONTHS },
      },
      data: { referral_months_granted: { increment: 1 } },
    });
  });

  it("marks the referral CAPPED, and grants nothing, once the cap is reached", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(activeSubscription);
    db.paymentHistory.findFirst.mockResolvedValue({ id: "pay_1" });
    db.user_tokens.updateMany.mockResolvedValue({ count: 0 });

    await maybeRewardReferral(payload());

    expect(db.referral.update.mock.calls[0][0].data).toEqual({ status: "CAPPED" });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("revokes a referral between two ever-teammates instead of paying it", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    sharedTeam();

    await maybeRewardReferral(payload());

    expect(db.referral.update.mock.calls[0][0].data).toEqual({ status: "REVOKED" });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("leaves the referral PENDING when the referrer has no active subscription", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(null);

    await maybeRewardReferral(payload());

    expect(db.referral.update).not.toHaveBeenCalled();
    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
  });

  it("will not un-cancel a subscription the referrer already cancelled", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue({
      ...activeSubscription,
      cancelAtNextBillingDate: true,
    });

    await maybeRewardReferral(payload());

    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(db.referral.update).not.toHaveBeenCalled();
  });

  it("refuses to reward a referrer who has never actually paid", async () => {
    // DodoPay has no "trialing" status, so a referrer still inside their own trial
    // reads as active — without this they could extend it forever by recruiting.
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(activeSubscription);
    db.paymentHistory.findFirst.mockResolvedValue(null);

    await maybeRewardReferral(payload());

    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
  });

  it("hands the reserved cap slot back when the DodoPay call fails", async () => {
    db.referral.findFirst.mockResolvedValue(pendingReferral);
    db.subscription.findFirst.mockResolvedValue(activeSubscription);
    db.paymentHistory.findFirst.mockResolvedValue({ id: "pay_1" });
    db.user_tokens.updateMany.mockResolvedValue({ count: 1 });
    subscriptionsUpdate.mockRejectedValueOnce(new Error("dodo 503"));

    await maybeRewardReferral(payload());

    const compensation = db.user_tokens.updateMany.mock.calls.at(-1)![0];
    expect(compensation.data).toEqual({ referral_months_granted: { decrement: 1 } });
    // Left PENDING so a later renewal webhook can retry it.
    expect(db.referral.update).not.toHaveBeenCalled();
  });

  it("never throws — it runs after the payment is already recorded", async () => {
    db.referral.findFirst.mockRejectedValue(new Error("database down"));

    expect(maybeRewardReferral(payload())).resolves.toBeUndefined();
  });
});
