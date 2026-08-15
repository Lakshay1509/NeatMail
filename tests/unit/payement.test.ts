import { beforeEach, describe, expect, it } from "bun:test";

import {
  addPaymenttoDb,
  addRefundtoDb,
  addSubscriptiontoDb,
  handleDisputeOpened,
  handleWatchActivation,
  handleWatchDeactivation,
} from "@/lib/payement";
import { db } from "../helpers/prisma-mock";
import { dodo } from "../helpers/dodo-mock";
import { gmail, outlook, supabaseHelpers, OAuthError } from "../helpers/provider-mock";
import { emailsFrom } from "../helpers/email-mock";
import { jobsFor } from "../helpers/queue-mock";

/**
 * The write path behind every DodoPay webhook. Two invariants here are the most
 * expensive in the codebase, and both are a one-line edit away from silently taking
 * money or seats from a paying customer:
 *
 *  1. An uninterpretable add-on cart (`sumMailboxAddons` → null) must leave the stored
 *     extraMailboxes ALONE. Writing 0 wipes paid seats across everyone on a deploy where
 *     an add-on id was rotated.
 *  2. Over-cap members are PAUSED, never detached. Detaching is irreversible (drops to
 *     FREE, latches trial_used) and the count driving it comes from a payload that can be
 *     stale or unreadable.
 */

const OWNER = "user_owner";

function subscriptionPayload(overrides: Record<string, any> = {}): any {
  return {
    type: "subscription.active",
    data: {
      subscription_id: "dodo_sub_1",
      product_id: "pdt_max_monthly_global",
      status: "active",
      currency: "USD",
      recurring_pre_tax_amount: 3900,
      quantity: 1,
      payment_frequency_interval: "Month",
      payment_frequency_count: 1,
      next_billing_date: "2026-09-15T00:00:00.000Z",
      previous_billing_date: "2026-08-15T00:00:00.000Z",
      cancel_at_next_billing_date: false,
      customer: {
        customer_id: "cus_1",
        email: "owner@acme.io",
        name: "Ada Lovelace",
      },
      addons: [],
      metadata: { clerk_user_id: OWNER, tier: "MAX" },
      ...overrides,
    },
  };
}

/**
 * `db.organization.findFirst` serves two different callers here — enforceSeatCap filters
 * by `created_by`, getOrganizationMemberIds by `OR`. Routing on the shape keeps them apart.
 */
function programOrg(options: {
  /** Members enforceSeatCap sees, earliest-joined first. */
  seatMembers?: { id: string; user_id: string }[] | null;
  /** Ids getBillingTeamIds fans out to. */
  teamMembers?: string[];
}) {
  const { seatMembers = null, teamMembers = [] } = options;
  db.organization.findFirst.mockImplementation(async (args: any) => {
    if (args.where?.OR) {
      return { members: teamMembers.map((user_id) => ({ user_id })) };
    }
    return seatMembers ? { members: seatMembers } : null;
  });
}

beforeEach(() => {
  db.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  );
  db.subscription.upsert.mockResolvedValue({ id: "sub_row_1" });
  db.organizationMember.findUnique.mockResolvedValue(null); // self-billed
  db.organizationMember.findMany.mockResolvedValue([]); // nobody paused
  db.user_tokens.findMany.mockResolvedValue([]); // nobody deleting
  programOrg({});
});

// ── The extraMailboxes guard ─────────────────────────────────────────────────

describe("addSubscriptiontoDb — paid seat count", () => {
  it("writes the seat count from an interpretable cart", async () => {
    await addSubscriptiontoDb(
      subscriptionPayload({
        addons: [{ addon_id: "addon_mbx_monthly_global", quantity: 3 }],
      }),
    );

    const args = db.subscription.upsert.mock.calls[0][0];
    expect(args.update.extraMailboxes).toBe(3);
    expect(args.create.extraMailboxes).toBe(3);
  });

  it("writes a genuine zero for an empty cart", async () => {
    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(db.subscription.upsert.mock.calls[0][0].update.extraMailboxes).toBe(0);
  });

  it("OMITS the field entirely when the cart is uninterpretable", async () => {
    // The invariant. `extraMailboxes: 0` here wipes paid seats; the key must be absent
    // so the stored value survives untouched.
    await addSubscriptiontoDb(subscriptionPayload({ addons: undefined }));

    const args = db.subscription.upsert.mock.calls[0][0];
    expect("extraMailboxes" in args.update).toBe(false);
    expect("extraMailboxes" in args.create).toBe(false);
  });

  it("omits it for a cart holding only unrecognised add-on ids", async () => {
    // The rotated-id case: an id dropped from the env list makes the cart unreadable.
    await addSubscriptiontoDb(
      subscriptionPayload({
        addons: [{ addon_id: "addon_rotated_away", quantity: 2 }],
      }),
    );

    expect("extraMailboxes" in db.subscription.upsert.mock.calls[0][0].update).toBe(
      false,
    );
  });

  it("omits it when no add-on product is configured at all", async () => {
    const keys = [
      "DODO_ADDON_MAILBOX_MONTHLY_INDIA",
      "DODO_ADDON_MAILBOX_MONTHLY_GLOBAL",
      "DODO_ADDON_MAILBOX_ANNUAL_INDIA",
      "DODO_ADDON_MAILBOX_ANNUAL_GLOBAL",
    ];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    for (const k of keys) delete process.env[k];
    try {
      await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

      expect("extraMailboxes" in db.subscription.upsert.mock.calls[0][0].update).toBe(
        false,
      );
    } finally {
      for (const [k, v] of saved) process.env[k] = v!;
    }
  });

  it("sums seats across regions and intervals", async () => {
    await addSubscriptiontoDb(
      subscriptionPayload({
        addons: [
          { addon_id: "addon_mbx_monthly_in", quantity: 1 },
          { addon_id: "addon_mbx_annual_global", quantity: 2 },
        ],
      }),
    );

    expect(db.subscription.upsert.mock.calls[0][0].update.extraMailboxes).toBe(3);
  });

  it("keeps the stored product current so an add-on-only change can't revert the plan", async () => {
    await addSubscriptiontoDb(
      subscriptionPayload({ product_id: "pdt_pro_annual_in" }),
    );

    expect(db.subscription.upsert.mock.calls[0][0].update.productId).toBe(
      "pdt_pro_annual_in",
    );
  });

  it("backfills orphaned payment rows with the subscription id", async () => {
    await addSubscriptiontoDb(subscriptionPayload());

    expect(db.paymentHistory.updateMany.mock.calls[0][0]).toEqual({
      where: { dodoSubscriptionId: "dodo_sub_1", subscriptionId: null },
      data: { subscriptionId: "sub_row_1" },
    });
  });
});

// ── Seat cap enforcement ─────────────────────────────────────────────────────

describe("addSubscriptiontoDb — seat cap", () => {
  const members = [
    { id: "m1", user_id: "user_first" },
    { id: "m2", user_id: "user_second" },
    { id: "m3", user_id: "user_third" },
  ];

  it("pauses the newest members beyond the cap, keeping the earliest", async () => {
    // MAX includes 1 seat; 3 active members means 2 must be paused.
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(db.organizationMember.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ["m2", "m3"] } },
      data: { active: false },
    });
  });

  it("PAUSES rather than detaches — the difference is reversibility", async () => {
    // detachMembersFromOrg deletes the membership, drops to FREE and latches
    // trial_used. Never acceptable from a count inferred off a webhook payload.
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(db.organizationMember.deleteMany).not.toHaveBeenCalled();
    const trialLatches = db.user_tokens.updateMany.mock.calls.filter(
      (c: any[]) => c[0].data?.trial_used !== undefined,
    );
    expect(trialLatches).toHaveLength(0);
  });

  it("SKIPS enforcement entirely when the cart is uninterpretable", async () => {
    // An unknown count must never be enforced as if it were zero.
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: undefined }));

    expect(db.organizationMember.updateMany).not.toHaveBeenCalled();
    expect(emailsFrom("sendSeatCapAlertEmail")).toHaveLength(0);
  });

  it("raises the cap by the paid seats, so nobody is paused while covered", async () => {
    // MAX (1) + 2 paid = 3 seats for 3 members.
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(
      subscriptionPayload({
        addons: [{ addon_id: "addon_mbx_monthly_global", quantity: 2 }],
      }),
    );

    expect(db.organizationMember.updateMany).not.toHaveBeenCalled();
  });

  it("ignores paid seats on a tier that may not hold them", async () => {
    // An out-of-band downgrade can land on PRO still carrying add-ons; counting them
    // would hand that PRO a team it doesn't include.
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(
      subscriptionPayload({
        product_id: "pdt_pro_monthly_global",
        addons: [{ addon_id: "addon_mbx_monthly_global", quantity: 2 }],
      }),
    );

    // PRO cap is 0, so all three are paused.
    expect(db.organizationMember.updateMany.mock.calls[0][0].where.id.in).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("stops the watch for each paused member", async () => {
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_second");
    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_third");
    expect(gmail.deactivateWatch).not.toHaveBeenCalledWith("user_first");
  });

  it("alerts the owner, since nothing un-pauses automatically", async () => {
    programOrg({ seatMembers: members, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    const [alert] = emailsFrom("sendSeatCapAlertEmail");
    expect(alert).toBeDefined();
    expect(alert.args[0]).toMatchObject({
      ownerId: OWNER,
      tier: "MAX",
      seatCap: 1,
      memberCount: 3,
      pausedUserIds: ["user_second", "user_third"],
    });
  });

  it("does nothing when the team already fits", async () => {
    programOrg({ seatMembers: [members[0]], teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(db.organizationMember.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when the owner has no org", async () => {
    programOrg({ seatMembers: null, teamMembers: [] });

    await addSubscriptiontoDb(subscriptionPayload({ addons: [] }));

    expect(db.organizationMember.updateMany).not.toHaveBeenCalled();
  });
});

// ── Activation fan-out ───────────────────────────────────────────────────────

describe("addSubscriptiontoDb — activation on active", () => {
  it("materialises the tier onto the whole billing team", async () => {
    programOrg({ teamMembers: [OWNER, "user_member"] });

    await addSubscriptiontoDb(subscriptionPayload());

    const tierWrite = db.user_tokens.updateMany.mock.calls.find(
      (c: any[]) => c[0].data?.tier,
    )!;
    expect(tierWrite[0].data).toEqual({ tier: "MAX" });
    expect(tierWrite[0].where.clerk_user_id.in).toEqual([OWNER, "user_member"]);
  });

  it("derives the tier from the product id, not the metadata", async () => {
    // Metadata is whatever checkout wrote; the product is what they actually hold.
    programOrg({ teamMembers: [OWNER] });

    await addSubscriptiontoDb(
      subscriptionPayload({
        product_id: "pdt_pro_monthly_global",
        metadata: { clerk_user_id: OWNER, tier: "MAX" },
      }),
    );

    const tierWrite = db.user_tokens.updateMany.mock.calls.find(
      (c: any[]) => c[0].data?.tier,
    )!;
    expect(tierWrite[0].data).toEqual({ tier: "PRO" });
  });

  it("falls back to metadata for an unrecognised product", async () => {
    programOrg({ teamMembers: [OWNER] });

    await addSubscriptiontoDb(
      subscriptionPayload({
        product_id: "pdt_grandfathered",
        metadata: { clerk_user_id: OWNER, tier: "PRO" },
      }),
    );

    const tierWrite = db.user_tokens.updateMany.mock.calls.find(
      (c: any[]) => c[0].data?.tier,
    )!;
    expect(tierWrite[0].data).toEqual({ tier: "PRO" });
  });

  it("queues mailbox activation for every member", async () => {
    programOrg({ teamMembers: [OWNER, "user_member"] });

    await addSubscriptiontoDb(subscriptionPayload());

    const jobs = jobsFor("mailboxActivationQueue");
    expect(jobs.map((j) => (j.data as { userId: string }).userId)).toEqual([
      OWNER,
      "user_member",
    ]);
    // jobId is the single-flight guard against /onboard-complete double-enqueuing.
    expect((jobs[0].opts as { jobId: string }).jobId).toBe(`activate-${OWNER}`);
  });

  it("tiers a paused member but does not re-arm their watch", async () => {
    programOrg({ teamMembers: [OWNER, "user_paused"] });
    db.organizationMember.findMany.mockResolvedValue([{ user_id: "user_paused" }]);

    await addSubscriptiontoDb(subscriptionPayload());

    const tierWrite = db.user_tokens.updateMany.mock.calls.find(
      (c: any[]) => c[0].data?.tier,
    )!;
    expect(tierWrite[0].where.clerk_user_id.in).toContain("user_paused");
    expect(jobsFor("mailboxActivationQueue").map((j) => (j.data as any).userId)).toEqual([
      OWNER,
    ]);
  });

  it("skips activation for a user flagged for deletion", async () => {
    programOrg({ teamMembers: [OWNER, "user_deleting"] });
    db.user_tokens.findMany.mockResolvedValue([{ clerk_user_id: "user_deleting" }]);

    await addSubscriptiontoDb(subscriptionPayload());

    expect(jobsFor("mailboxActivationQueue").map((j) => (j.data as any).userId)).toEqual([
      OWNER,
    ]);
  });

  it("refuses to fan out when metadata carries no clerk user id", async () => {
    // An undefined id would make the Prisma filter match any org — fail closed.
    await addSubscriptiontoDb(subscriptionPayload({ metadata: {} }));

    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
    expect(jobsFor("mailboxActivationQueue")).toHaveLength(0);
  });

  it("survives a queue outage without failing the paid subscription", async () => {
    programOrg({ teamMembers: [OWNER] });
    const { queues } = await import("../helpers/queue-mock");
    queues.mailboxActivationQueue.add.mockRejectedValue(new Error("redis down"));

    expect(addSubscriptiontoDb(subscriptionPayload())).resolves.toBeDefined();
  });

  it("does none of this for a non-active status", async () => {
    programOrg({ teamMembers: [OWNER] });

    await addSubscriptiontoDb(subscriptionPayload({ status: "pending" }));

    expect(jobsFor("mailboxActivationQueue")).toHaveLength(0);
  });
});

// ── Teardown ─────────────────────────────────────────────────────────────────

describe("addSubscriptiontoDb — teardown on a dead subscription", () => {
  const deadStatuses = ["expired", "cancelled", "failed", "on_hold", "pending"];

  beforeEach(() => {
    db.subscription.findFirst.mockResolvedValue(null); // no other active subscription
    db.free_trial.findFirst.mockResolvedValue(null);
    programOrg({ teamMembers: [OWNER, "user_member"] });
  });

  it("downgrades the whole team to FREE and stops their watches", async () => {
    await addSubscriptiontoDb(subscriptionPayload({ status: "cancelled" }));

    const tierWrite = db.user_tokens.updateMany.mock.calls.at(-1)![0];
    expect(tierWrite.data).toEqual({ tier: "FREE" });
    expect(tierWrite.where.clerk_user_id.in).toEqual([OWNER, "user_member"]);
    expect(gmail.deactivateWatch).toHaveBeenCalledTimes(2);
  });

  it("tears down on every dead status", async () => {
    for (const status of deadStatuses) {
      db.user_tokens.updateMany.mockClear();
      await addSubscriptiontoDb(subscriptionPayload({ status }));

      expect(db.user_tokens.updateMany.mock.calls.at(-1)![0].data).toEqual({
        tier: "FREE",
      });
    }
  });

  it("keeps MAX when an active trial still covers the team", async () => {
    db.free_trial.findFirst.mockResolvedValue({
      user_id: OWNER,
      status: "ACTIVE",
      expires_at: new Date(Date.now() + 86_400_000),
    });

    await addSubscriptiontoDb(subscriptionPayload({ status: "cancelled" }));

    expect(db.user_tokens.updateMany.mock.calls.at(-1)![0].data).toEqual({
      tier: "MAX",
    });
  });

  it("does NOT tear down when the subject no longer owns billing", async () => {
    // A member's own old subscription can emit a late cancelled webhook after they
    // joined an org. Tearing down here would strip a covered member.
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });

    await addSubscriptiontoDb(
      subscriptionPayload({
        status: "cancelled",
        metadata: { clerk_user_id: "user_member" },
      }),
    );

    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
    expect(gmail.deactivateWatch).not.toHaveBeenCalled();
  });

  it("does NOT tear down while another subscription is still active", async () => {
    db.subscription.findFirst.mockResolvedValue({ id: "sub_other", status: "active" });

    await addSubscriptiontoDb(subscriptionPayload({ status: "cancelled" }));

    expect(db.user_tokens.updateMany).not.toHaveBeenCalled();
    expect(emailsFrom("sendSubExpiredEmail")).toHaveLength(0);
  });

  it("excludes the subscription being torn down from the still-active check", async () => {
    await addSubscriptiontoDb(subscriptionPayload({ status: "cancelled" }));

    expect(db.subscription.findFirst.mock.calls[0][0].where).toMatchObject({
      status: "active",
      dodoSubscriptionId: { not: "dodo_sub_1" },
    });
  });

  it("emails the customer that their subscription ended", async () => {
    await addSubscriptiontoDb(subscriptionPayload({ status: "expired" }));

    expect(emailsFrom("sendSubExpiredEmail")[0].args).toEqual([
      "owner@acme.io",
      "Ada Lovelace",
    ]);
  });
});

// ── Chargebacks vs refunds ───────────────────────────────────────────────────

describe("handleDisputeOpened", () => {
  const disputePayload = { data: { payment_id: "pay_1" } } as any;

  it("strips every paid seat without crediting the customer", async () => {
    // They already have the cash via the chargeback; a credit would pay them twice.
    db.paymentHistory.findUnique.mockResolvedValue({
      subscription: {
        dodoSubscriptionId: "dodo_sub_1",
        productId: "pdt_max_monthly_global",
        clerkUserId: OWNER,
        extraMailboxes: 2,
      },
    });

    await handleDisputeOpened(disputePayload);

    expect(dodo.subscriptions.changePlan.mock.calls[0][1]).toMatchObject({
      product_id: "pdt_max_monthly_global",
      proration_billing_mode: "do_not_bill",
      addons: [],
    });
  });

  it("tells the owner their seats were revoked", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      subscription: {
        dodoSubscriptionId: "dodo_sub_1",
        productId: "pdt_max_monthly_global",
        clerkUserId: OWNER,
        extraMailboxes: 2,
      },
    });

    await handleDisputeOpened(disputePayload);

    expect(emailsFrom("sendMailboxRevokedEmail")[0].args[0]).toMatchObject({
      ownerId: OWNER,
      revokedCount: 2,
      reason: "chargeback opened",
    });
  });

  it("does nothing when the payment bought no seats", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      subscription: { extraMailboxes: 0 },
    });

    await handleDisputeOpened(disputePayload);

    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("does nothing for a payment with no linked subscription", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({ subscription: null });

    await handleDisputeOpened(disputePayload);

    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("never throws — the webhook must still ack", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      subscription: {
        dodoSubscriptionId: "dodo_sub_1",
        productId: "pdt_max_monthly_global",
        clerkUserId: OWNER,
        extraMailboxes: 2,
      },
    });
    dodo.subscriptions.changePlan.mockRejectedValue(new Error("dodo 500"));

    expect(handleDisputeOpened(disputePayload)).resolves.toBeUndefined();
  });
});

describe("addRefundtoDb", () => {
  const refundPayload = (overrides: Record<string, any> = {}): any => ({
    data: {
      refund_id: "ref_1",
      payment_id: "pay_1",
      amount: 3900,
      currency: "USD",
      status: "succeeded",
      reason: "requested_by_customer",
      is_partial: false,
      metadata: { clerk_user_id: OWNER },
      ...overrides,
    },
  });

  it("records the refund", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({ id: "pay_row_1", subscriptionId: null });

    await addRefundtoDb(refundPayload());

    expect(db.refund.upsert.mock.calls[0][0].where).toEqual({ dodoRefundId: "ref_1" });
  });

  it("does NOT revoke seats — a refund is merchant-initiated, unlike a chargeback", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      id: "pay_row_1",
      subscriptionId: "sub_row_1",
    });
    db.subscription.findUnique.mockResolvedValue({
      clerkUserId: OWNER,
      extraMailboxes: 3,
    });

    await addRefundtoDb(refundPayload());

    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });

  it("alerts instead, so a seat refund stays a human decision", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      id: "pay_row_1",
      subscriptionId: "sub_row_1",
    });
    db.subscription.findUnique.mockResolvedValue({
      clerkUserId: OWNER,
      extraMailboxes: 3,
    });

    await addRefundtoDb(refundPayload());

    expect(emailsFrom("sendRefundWithSeatsEmail")[0].args[0]).toMatchObject({
      ownerId: OWNER,
      seatCount: 3,
    });
  });

  it("sends no alert when the subscription holds no paid seats", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      id: "pay_row_1",
      subscriptionId: "sub_row_1",
    });
    db.subscription.findUnique.mockResolvedValue({
      clerkUserId: OWNER,
      extraMailboxes: 0,
    });

    await addRefundtoDb(refundPayload());

    expect(emailsFrom("sendRefundWithSeatsEmail")).toHaveLength(0);
  });

  it("sends no alert for a failed refund", async () => {
    db.paymentHistory.findUnique.mockResolvedValue({
      id: "pay_row_1",
      subscriptionId: "sub_row_1",
    });
    db.subscription.findUnique.mockResolvedValue({
      clerkUserId: OWNER,
      extraMailboxes: 3,
    });

    await addRefundtoDb(refundPayload({ status: "failed" }));

    expect(emailsFrom("sendRefundWithSeatsEmail")).toHaveLength(0);
  });

  it("returns quietly for an unknown payment rather than looping on retries", async () => {
    // Throwing turns into a 500, DodoPay redelivers, and it fails identically forever.
    db.paymentHistory.findUnique.mockResolvedValue(null);

    expect(addRefundtoDb(refundPayload())).resolves.toBeUndefined();
    expect(db.refund.upsert).not.toHaveBeenCalled();
  });
});

// ── Payment recording ────────────────────────────────────────────────────────

describe("addPaymenttoDb", () => {
  const paymentPayload = (overrides: Record<string, any> = {}): any => ({
    data: {
      payment_id: "pay_1",
      subscription_id: "dodo_sub_1",
      total_amount: 3900,
      settlement_amount: 3900,
      currency: "USD",
      status: "succeeded",
      payment_method: "card",
      payment_method_type: "credit",
      metadata: { clerk_user_id: OWNER },
      ...overrides,
    },
  });

  it("records the payment against its subscription", async () => {
    db.subscription.findUnique.mockResolvedValue({ id: "sub_row_1" });
    db.paymentHistory.findUnique.mockResolvedValue(null);

    await addPaymenttoDb(paymentPayload());

    const args = db.paymentHistory.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ dodoPaymentId: "pay_1" });
    expect(args.create.amount).toBe(3900);
    expect(args.update.subscriptionId).toBe("sub_row_1");
  });

  it("skips a redelivery that carries no status change", async () => {
    db.subscription.findUnique.mockResolvedValue({ id: "sub_row_1" });
    db.paymentHistory.findUnique.mockResolvedValue({ status: "succeeded" });

    await addPaymenttoDb(paymentPayload());

    expect(db.paymentHistory.upsert).not.toHaveBeenCalled();
  });

  it("still writes when the status advanced", async () => {
    db.subscription.findUnique.mockResolvedValue({ id: "sub_row_1" });
    db.paymentHistory.findUnique.mockResolvedValue({ status: "processing" });

    await addPaymenttoDb(paymentPayload({ status: "succeeded" }));

    expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(1);
  });

  it("ignores a payment with no subscription attached", async () => {
    await addPaymenttoDb(paymentPayload({ subscription_id: null }));

    expect(db.paymentHistory.upsert).not.toHaveBeenCalled();
  });

  it("retries a missing subscription, then throws so DodoPay redelivers", async () => {
    // The webhook can beat subscription.created. Collapse the 2s backoff so the
    // retry path is testable without a 6-second wait.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) =>
      realSetTimeout(fn, 0)) as typeof globalThis.setTimeout;
    db.subscription.findUnique.mockResolvedValue(null);
    try {
      expect(addPaymenttoDb(paymentPayload())).rejects.toThrow(
        "Subscription dodo_sub_1 not found",
      );
      // Initial attempt plus MAX_RETRIES.
      expect(db.subscription.findUnique).toHaveBeenCalledTimes(4);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it("succeeds if the subscription lands mid-retry", async () => {
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) =>
      realSetTimeout(fn, 0)) as typeof globalThis.setTimeout;
    db.subscription.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: "sub_row_1" });
    db.paymentHistory.findUnique.mockResolvedValue(null);
    try {
      await addPaymenttoDb(paymentPayload());
      expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

// ── Watch lifecycle ──────────────────────────────────────────────────────────

describe("handleWatchActivation", () => {
  it("arms a Gmail watch and stores the history id", async () => {
    expect(await handleWatchActivation("user_1")).toBe(true);
    expect(db.user_tokens.update.mock.calls[0][0].data).toMatchObject({
      watch_activated: true,
      last_history_id: "hist_1",
    });
  });

  it("creates Outlook subscriptions for the active folders", async () => {
    supabaseHelpers.getUserIsGmail.mockResolvedValue({ isGmail: false });
    outlook.createOutlookSubscription.mockResolvedValue([
      { id: "sub_a" },
      { id: "sub_b" },
    ]);

    expect(await handleWatchActivation("user_1")).toBe(true);
    expect(db.user_tokens.update.mock.calls[0][0].data).toMatchObject({
      outlook_id: "sub_a,sub_b",
      watch_activated: true,
    });
  });

  it("passes only active folders to Outlook", async () => {
    supabaseHelpers.getUserIsGmail.mockResolvedValue({ isGmail: false });
    supabaseHelpers.activeFolder.mockResolvedValue([
      { id: "f1", name: "Inbox", isActive: true },
      { id: "f2", name: "Archive", isActive: false },
    ]);

    await handleWatchActivation("user_1");

    expect(outlook.createOutlookSubscription.mock.calls[0][1]).toEqual([
      { id: "f1", name: "Inbox" },
    ]);
  });

  it("returns false rather than throwing when the provider fails", async () => {
    gmail.activateWatch.mockRejectedValue(new Error("gmail 500"));

    expect(await handleWatchActivation("user_1")).toBe(false);
    expect(db.user_tokens.update).not.toHaveBeenCalled();
  });

  it("returns false when the provider reports no success", async () => {
    gmail.activateWatch.mockResolvedValue({ success: false });

    expect(await handleWatchActivation("user_1")).toBe(false);
  });
});

describe("handleWatchDeactivation", () => {
  it("stops the Gmail watch and clears local state", async () => {
    await handleWatchDeactivation("user_1");

    expect(gmail.deactivateWatch).toHaveBeenCalledWith("user_1");
    expect(db.user_tokens.update.mock.calls[0][0].data).toMatchObject({
      watch_activated: false,
      last_history_id: null,
    });
  });

  it("deletes the Outlook subscription and clears outlook_id", async () => {
    supabaseHelpers.getUserIsGmail.mockResolvedValue({ isGmail: false });

    await handleWatchDeactivation("user_1");

    expect(outlook.deleteOutlookSubscription).toHaveBeenCalledWith("user_1");
    expect(db.user_tokens.update.mock.calls[0][0].data).toMatchObject({
      watch_activated: false,
      outlook_id: null,
    });
  });

  it("clears local state anyway when OAuth was revoked", async () => {
    // The provider call can never succeed; the watch lapses on its own.
    gmail.deactivateWatch.mockRejectedValue(new OAuthError());

    await handleWatchDeactivation("user_1");

    expect(db.user_tokens.update.mock.calls[0][0].data).toMatchObject({
      watch_activated: false,
    });
  });

  it("recognises a revoked token from a bare 401/403 too", async () => {
    for (const status of [401, 403, 400]) {
      db.user_tokens.update.mockClear();
      const err = Object.assign(new Error("nope"), { status });
      gmail.deactivateWatch.mockRejectedValue(err);

      await handleWatchDeactivation("user_1");

      expect(db.user_tokens.update).toHaveBeenCalledTimes(1);
    }
  });

  it("leaves watch_activated alone on a transient failure, so a retry can deactivate", async () => {
    gmail.deactivateWatch.mockRejectedValue(new Error("network timeout"));

    await handleWatchDeactivation("user_1");

    expect(db.user_tokens.update).not.toHaveBeenCalled();
  });

  it("never throws, even with no user row at all", async () => {
    supabaseHelpers.getUserIsGmail.mockRejectedValue(new Error("no such user"));

    expect(handleWatchDeactivation("user_ghost")).resolves.toBeUndefined();
  });
});
