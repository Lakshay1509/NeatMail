import { mock, type Mock } from "bun:test";

/**
 * Stand-in for the `dodopayments` SDK. `getDodoPayments()` constructs a client per call,
 * so the double is built once at module scope and returned by every construction — that
 * way a test can program `dodo.subscriptions.changePlan` before the route builds its own
 * client, and assert on it afterwards.
 */

type AnyMock = Mock<(...args: any[]) => any>;

/** A DodoPay-shaped preview response, overridable per test. */
export function previewResponse(overrides: Record<string, any> = {}) {
  return {
    immediate_charge: {
      summary: {
        total_amount: 0,
        customer_credits: 0,
        settlement_amount: 0,
        tax: 0,
        currency: "USD",
        ...(overrides.summary ?? {}),
      },
    },
    new_plan: {
      recurring_pre_tax_amount: 1900,
      currency: "USD",
      next_billing_date: "2026-09-15T00:00:00.000Z",
      payment_frequency_interval: "Month",
      payment_frequency_count: 1,
      ...(overrides.new_plan ?? {}),
    },
  };
}

export const dodo = {
  checkoutSessions: {
    create: mock(async () => ({
      checkout_url: "https://checkout.test.local/session_1",
      session_id: "session_1",
    })) as AnyMock,
  },
  subscriptions: {
    changePlan: mock(async () => ({ ok: true })) as AnyMock,
    previewChangePlan: mock(async () => previewResponse()) as AnyMock,
    update: mock(async () => ({ ok: true })) as AnyMock,
    updatePaymentMethod: mock(async () => ({
      payment_id: "pay_new_method",
      payment_link: "https://checkout.test.local/update-method",
    })) as AnyMock,
  },
  invoices: {
    payments: {
      retrieve: mock(async () => new Response(new Uint8Array([37, 80, 68, 70]))) as AnyMock,
    },
  },
  customers: {
    customerPortal: {
      create: mock(async () => ({
        link: "https://portal.test.local/customer_1",
      })) as AnyMock,
    },
  },
};

/** Constructor args each `new DodoPayments(...)` was called with. */
export const dodoConstructorCalls: unknown[] = [];

export class FakeDodoPayments {
  constructor(options?: unknown) {
    dodoConstructorCalls.push(options);
    Object.assign(this, dodo);
  }
}

export function resetDodo(): void {
  dodoConstructorCalls.length = 0;

  dodo.checkoutSessions.create.mockReset();
  dodo.checkoutSessions.create.mockImplementation(async () => ({
    checkout_url: "https://checkout.test.local/session_1",
    session_id: "session_1",
  }));

  dodo.subscriptions.changePlan.mockReset();
  dodo.subscriptions.changePlan.mockImplementation(async () => ({ ok: true }));

  dodo.subscriptions.previewChangePlan.mockReset();
  dodo.subscriptions.previewChangePlan.mockImplementation(async () => previewResponse());

  dodo.subscriptions.update.mockReset();
  dodo.subscriptions.update.mockImplementation(async () => ({ ok: true }));

  dodo.subscriptions.updatePaymentMethod.mockReset();
  dodo.subscriptions.updatePaymentMethod.mockImplementation(async () => ({
    payment_id: "pay_new_method",
    payment_link: "https://checkout.test.local/update-method",
  }));

  dodo.invoices.payments.retrieve.mockReset();
  dodo.invoices.payments.retrieve.mockImplementation(
    async () => new Response(new Uint8Array([37, 80, 68, 70])),
  );

  dodo.customers.customerPortal.create.mockReset();
  dodo.customers.customerPortal.create.mockImplementation(async () => ({
    link: "https://portal.test.local/customer_1",
  }));
}

// ── Raw fetch interception ───────────────────────────────────────────────────
// Some DodoPay calls bypass the SDK and hit the REST API with `fetch` directly
// (resume-on-checkout, cancel/renew). Those need a separate seam.

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Every intercepted request, in order. */
export const fetchCalls: FetchCall[] = [];

const realFetch = globalThis.fetch;
let responder: (call: FetchCall) => Response = () =>
  new Response(JSON.stringify({ ok: true }), { status: 200 });

/** Replaces the outbound response for subsequent intercepted calls. */
export function setFetchResponse(fn: (call: FetchCall) => Response): void {
  responder = fn;
}

/** Convenience: fail every intercepted call with `status`. */
export function failFetch(status = 502, body = "upstream error"): void {
  setFetchResponse(() => new Response(body, { status }));
}

export function installFetchMock(): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const call: FetchCall = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    fetchCalls.push(call);
    return responder(call);
  }) as typeof fetch;
}

export function resetFetchMock(): void {
  fetchCalls.length = 0;
  responder = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
}

export function restoreFetch(): void {
  globalThis.fetch = realFetch;
}
