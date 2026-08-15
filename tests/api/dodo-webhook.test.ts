import { beforeEach, describe, expect, it, mock } from "bun:test";

import { mountRouter } from "../helpers/api";
import { redis } from "@/lib/redis";
import { db } from "../helpers/prisma-mock";
import { dodo } from "../helpers/dodo-mock";

/**
 * These tests cover the webhook ENVELOPE — signature verification, idempotency, and
 * which handler each event type reaches. The DB writes those handlers perform are
 * tests/unit/payement.test.ts's job.
 *
 * Neither `@/lib/payement` nor `@/lib/referral` is mocked here, deliberately.
 * `mock.module` is process-global in Bun, so mocking a module another file exercises for
 * real replaces it there too: doing that to `@/lib/referral` silently broke 16
 * assertions in referral.test.ts, and `@/lib/payement` broke 43 in payement.test.ts.
 * Dispatch is asserted through each handler's first observable effect instead, which has
 * the side benefit of exercising the real wiring rather than a stub of it:
 *
 *   addSubscriptiontoDb  → db.subscription.upsert
 *   addPaymenttoDb       → db.paymentHistory.upsert
 *   addRefundtoDb        → db.refund.upsert
 *   handleDisputeOpened  → dodo.subscriptions.changePlan   (seat revocation)
 *   maybeRewardReferral  → db.referral.findFirst
 *
 * `@/lib/trial-reminder` and `standardwebhooks` stay mocked: no other file touches them,
 * so there is nothing to collide with.
 */
const maybeScheduleTrialReminder = mock(async (_payload?: unknown) => undefined);

/** Flip to make `webhook.verify` reject, simulating a forged signature. */
let verifyFails = false;
const verify = mock(async () => {
  if (verifyFails) throw new Error("invalid signature");
  return true;
});

mock.module("@/lib/trial-reminder", () => ({ maybeScheduleTrialReminder }));
mock.module("standardwebhooks", () => ({
  Webhook: class {
    constructor(_secret: string) {}
    verify = verify;
  },
}));

const webhookRoute = (await import("@/app/api/[[...route]]/dodo-webhook")).default;
const api = mountRouter("/dodowebhook", webhookRoute);

let webhookCounter = 0;

/** Posts a signed-looking event. Each call gets a fresh id so idempotency is opt-in. */
function post(
  payload: Record<string, unknown>,
  options: { id?: string; headers?: Record<string, string> } = {},
) {
  const id = options.id ?? `whk_${++webhookCounter}`;
  return api.post("/dodowebhook", {
    body: payload,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": "1755259200",
      "webhook-signature": "v1,dGVzdC1zaWduYXR1cmU=",
      ...(options.headers ?? {}),
    },
  });
}

/** Status is omitted so neither the activation nor the teardown branch fires. */
const subscriptionEvent = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  data: {
    subscription_id: "dodo_sub_1",
    product_id: "pdt_max_monthly_global",
    currency: "USD",
    recurring_pre_tax_amount: 3900,
    quantity: 1,
    payment_frequency_interval: "Month",
    payment_frequency_count: 1,
    next_billing_date: "2026-09-15T00:00:00.000Z",
    previous_billing_date: "2026-08-15T00:00:00.000Z",
    cancel_at_next_billing_date: false,
    customer: { customer_id: "cus_1", email: "owner@acme.io", name: "Ada" },
    addons: [],
    metadata: { clerk_user_id: "user_1", tier: "MAX", interval: "monthly" },
    ...data,
  },
});

const paymentEvent = (type: string, amount = 3900) => ({
  type,
  data: {
    payment_id: "pay_1",
    subscription_id: "dodo_sub_1",
    total_amount: amount,
    settlement_amount: amount,
    amount,
    currency: "USD",
    status: type === "payment.succeeded" ? "succeeded" : type.split(".")[1],
    payment_method: "card",
    payment_method_type: "credit",
    metadata: { clerk_user_id: "user_1" },
  },
});

beforeEach(() => {
  verifyFails = false;
  maybeScheduleTrialReminder.mockClear();
  verify.mockClear();

  db.$transaction.mockImplementation(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(db),
  );
  db.subscription.upsert.mockResolvedValue({ id: "sub_row_1" });
  // addPaymenttoDb retries with a 2s backoff when the subscription is missing.
  db.subscription.findUnique.mockResolvedValue({ id: "sub_row_1" });
  db.paymentHistory.findUnique.mockResolvedValue(null);
  db.organizationMember.findUnique.mockResolvedValue(null);
  db.organization.findFirst.mockResolvedValue(null);
  // maybeRewardReferral runs for real; with no pending referral it is a no-op.
  db.referral.findFirst.mockResolvedValue(null);
});

describe("envelope", () => {
  it("400s without the webhook headers", async () => {
    for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const headers: Record<string, string> = {
        "webhook-id": "whk_x",
        "webhook-timestamp": "1755259200",
        "webhook-signature": "v1,sig",
      };
      delete headers[missing];

      const res = await api.post("/dodowebhook", {
        body: subscriptionEvent("subscription.created"),
        headers,
      });

      expect(res.status).toBe(400);
    }
    expect(db.subscription.upsert).not.toHaveBeenCalled();
  });

  it("400s and processes nothing when the signature is forged", async () => {
    verifyFails = true;

    const res = await post(subscriptionEvent("subscription.created"));

    expect(res.status).toBe(400);
    expect(db.subscription.upsert).not.toHaveBeenCalled();
  });

  it("releases the idempotency mark on a failed signature so a retry can land", async () => {
    verifyFails = true;
    await post(subscriptionEvent("subscription.created"), { id: "whk_retry" });

    // Same id, now with a good signature — must not be swallowed as a duplicate.
    verifyFails = false;
    const res = await post(subscriptionEvent("subscription.created"), {
      id: "whk_retry",
    });

    expect(res.status).toBe(200);
    expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
  });

  it("400s when the webhook secret is not configured", async () => {
    const original = process.env.DODO_WEBHOOK_SECRET;
    delete process.env.DODO_WEBHOOK_SECRET;
    try {
      const res = await post(subscriptionEvent("subscription.created"));
      expect(res.status).toBe(400);
    } finally {
      process.env.DODO_WEBHOOK_SECRET = original;
    }
  });

  it("acknowledges an unhandled event type without erroring", async () => {
    const res = await post({ type: "some.future.event", data: {} });

    expect(res.status).toBe(200);
    expect(db.subscription.upsert).not.toHaveBeenCalled();
    expect(db.paymentHistory.upsert).not.toHaveBeenCalled();
  });

  it("500s and clears the mark when a handler throws, so DodoPay can retry", async () => {
    db.subscription.upsert.mockRejectedValue(new Error("db down"));

    const res = await post(subscriptionEvent("subscription.created"), {
      id: "whk_boom",
    });

    expect(res.status).toBe(500);
    expect(await redis.exists("processed:dodo:whk_boom")).toBe(0);
  });
});

describe("idempotency", () => {
  it("KNOWN GAP: truly concurrent deliveries of one id both process", async () => {
    // Documents current behaviour, not desired behaviour. The guard is
    //   if (await isDodoWebhookProcessed(id)) return;   // EXISTS
    //   await markDodoWebhookProcessed(id);             // SETEX
    // — a check-then-set across two round trips, so both requests read "not seen"
    // before either writes. The comment above it in dodo-webhook.ts claims this
    // "prevent[s] duplicate concurrent processing"; it does not.
    //
    // Real Redis latency widens this window rather than closing it. The fix is an
    // atomic claim (SET NX), exactly as claimReferralReward already does in
    // lib/redis.ts. When that lands, flip this to expect 1 call and rename it.
    const event = paymentEvent("payment.succeeded");
    const [a, b] = await Promise.all([
      post(event, { id: "whk_concurrent" }),
      post(event, { id: "whk_concurrent" }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(2);
  });

  it("dedupes sequential redeliveries, which is what DodoPay's retries actually send", async () => {
    // The guarantee that does hold: a retry arriving after the first completed.
    await post(paymentEvent("payment.succeeded"), { id: "whk_sequential" });
    await post(paymentEvent("payment.succeeded"), { id: "whk_sequential" });
    await post(paymentEvent("payment.succeeded"), { id: "whk_sequential" });

    expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(1);
  });

  it("treats distinct ids as distinct events", async () => {
    await post(paymentEvent("payment.succeeded"), { id: "whk_a" });
    await post(paymentEvent("payment.succeeded"), { id: "whk_b" });

    expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(2);
  });

  it("does not verify a duplicate at all — it short-circuits first", async () => {
    await post(paymentEvent("payment.succeeded"), { id: "whk_short" });
    verify.mockClear();

    await post(paymentEvent("payment.succeeded"), { id: "whk_short" });

    expect(verify).not.toHaveBeenCalled();
  });
});

describe("subscription events", () => {
  const types = [
    "subscription.created",
    "subscription.cancelled",
    "subscription.updated",
    "subscription.plan_changed",
    "subscription.active",
    "subscription.renewed",
    "subscription.failed",
    "subscription.expired",
    "subscription.on_hold",
  ];

  it("routes every subscription event to addSubscriptiontoDb", async () => {
    for (const type of types) {
      db.subscription.upsert.mockClear();
      const res = await post(subscriptionEvent(type));

      expect(res.status).toBe(200);
      expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
    }
  });

  it("hands the payload's subscription id straight through", async () => {
    await post(subscriptionEvent("subscription.created"));

    expect(db.subscription.upsert.mock.calls[0][0].where).toEqual({
      dodoSubscriptionId: "dodo_sub_1",
    });
  });

  it("writes back plan_changed — the event that makes extraMailboxes authoritative", async () => {
    // Without it a paid mailbox never reaches the DB and the seat cap never grows.
    const res = await post(
      subscriptionEvent("subscription.plan_changed", {
        addons: [{ addon_id: "addon_mbx_monthly_global", quantity: 2 }],
      }),
    );

    expect(res.status).toBe(200);
    expect(db.subscription.upsert.mock.calls[0][0].update.extraMailboxes).toBe(2);
  });

  it("does not touch payment or refund handlers", async () => {
    await post(subscriptionEvent("subscription.created"));

    expect(db.paymentHistory.upsert).not.toHaveBeenCalled();
    expect(db.refund.upsert).not.toHaveBeenCalled();
  });
});

describe("payment events", () => {
  it("records a succeeded payment, then schedules the trial reminder and referral reward", async () => {
    const res = await post(paymentEvent("payment.succeeded"));

    expect(res.status).toBe(200);
    expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(1);
    expect(maybeScheduleTrialReminder).toHaveBeenCalledTimes(1);
    // maybeRewardReferral runs for real; looking for a pending referral is its
    // first observable step.
    expect(db.referral.findFirst).toHaveBeenCalledTimes(1);
  });

  it("records the payment before the follow-on side effects", async () => {
    const order: string[] = [];
    db.paymentHistory.upsert.mockImplementation(async () => {
      order.push("payment");
      return {};
    });
    db.referral.findFirst.mockImplementation(async () => {
      order.push("referral");
      return null;
    });

    await post(paymentEvent("payment.succeeded"));

    expect(order).toEqual(["payment", "referral"]);
  });

  it("passes a $0 trial-start charge through — the reminder path needs it", async () => {
    await post(paymentEvent("payment.succeeded", 0));

    expect(maybeScheduleTrialReminder.mock.calls[0][0]).toMatchObject({
      data: { total_amount: 0 },
    });
  });

  it("records processing, cancelled and failed payments without side effects", async () => {
    for (const type of ["payment.processing", "payment.cancelled", "payment.failed"]) {
      db.paymentHistory.upsert.mockClear();
      maybeScheduleTrialReminder.mockClear();
      db.referral.findFirst.mockClear();

      const res = await post(paymentEvent(type));

      expect(res.status).toBe(200);
      expect(db.paymentHistory.upsert).toHaveBeenCalledTimes(1);
      // Only a succeeded payment can convert a referral or start a trial clock.
      expect(db.referral.findFirst).not.toHaveBeenCalled();
      expect(maybeScheduleTrialReminder).not.toHaveBeenCalled();
    }
  });

  it("500s when recording the payment fails, leaving it retryable", async () => {
    db.paymentHistory.upsert.mockRejectedValue(new Error("write failed"));

    const res = await post(paymentEvent("payment.succeeded"), { id: "whk_payfail" });

    expect(res.status).toBe(500);
    expect(await redis.exists("processed:dodo:whk_payfail")).toBe(0);
  });
});

describe("dispute events", () => {
  const disputeEvent = (type: string) => ({
    type,
    data: {
      dispute_id: "dsp_1",
      payment_id: "pay_1",
      amount: 3900,
      currency: "USD",
      metadata: { clerk_user_id: "user_1" },
    },
  });

  /** A chargeback can only strip seats if the payment resolves to a subscription. */
  function paymentWithSeats(extraMailboxes = 2) {
    db.paymentHistory.findUnique.mockResolvedValue({
      subscription: {
        dodoSubscriptionId: "dodo_sub_1",
        productId: "pdt_max_monthly_global",
        clerkUserId: "user_1",
        extraMailboxes,
      },
    });
  }

  it("strips seats immediately when a chargeback opens", async () => {
    paymentWithSeats();

    const res = await post(disputeEvent("dispute.opened"));

    expect(res.status).toBe(200);
    expect(dodo.subscriptions.changePlan).toHaveBeenCalledTimes(1);
    expect(dodo.subscriptions.changePlan.mock.calls[0][1].addons).toEqual([]);
  });

  it("records the remaining dispute lifecycle without undoing anything", async () => {
    // The seats are already gone by then, and winning does not restore them.
    for (const type of [
      "dispute.accepted",
      "dispute.cancelled",
      "dispute.challenged",
      "dispute.expired",
      "dispute.lost",
      "dispute.won",
    ]) {
      paymentWithSeats();
      dodo.subscriptions.changePlan.mockClear();

      const res = await post(disputeEvent(type));

      expect(res.status).toBe(200);
      expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
    }
  });
});

describe("refund events", () => {
  const refundEvent = (type: string) => ({
    type,
    data: {
      refund_id: "ref_1",
      payment_id: "pay_1",
      amount: 3900,
      currency: "USD",
      status: type === "refund.succeeded" ? "succeeded" : "failed",
      reason: "requested_by_customer",
      is_partial: false,
      metadata: { clerk_user_id: "user_1" },
    },
  });

  beforeEach(() => {
    db.paymentHistory.findUnique.mockResolvedValue({
      id: "pay_row_1",
      subscriptionId: null,
    });
  });

  it("records a succeeded refund", async () => {
    const res = await post(refundEvent("refund.succeeded"));

    expect(res.status).toBe(200);
    expect(db.refund.upsert).toHaveBeenCalledTimes(1);
  });

  it("records a failed refund too", async () => {
    const res = await post(refundEvent("refund.failed"));

    expect(res.status).toBe(200);
    expect(db.refund.upsert).toHaveBeenCalledTimes(1);
  });

  it("never strips seats on a refund, unlike a chargeback", async () => {
    await post(refundEvent("refund.succeeded"));

    expect(dodo.subscriptions.changePlan).not.toHaveBeenCalled();
  });
});

describe("analytics identity", () => {
  it("does not fail an event whose metadata carries no clerk user id", async () => {
    const res = await post(subscriptionEvent("subscription.created", { metadata: {} }));

    expect(res.status).toBe(200);
    expect(db.subscription.upsert).toHaveBeenCalledTimes(1);
  });
});
