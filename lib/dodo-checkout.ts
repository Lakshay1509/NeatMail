"use client";

import { DodoPayments, type CheckoutEvent } from "dodopayments-checkout";
import posthog from "posthog-js";

// Overlay checkout; CSP in next.config.ts must allow *.dodopayments.com in script-src/connect-src/frame-src.

// Matches the server's environment choice in getDodoPayments (checkout.ts).
const MODE = process.env.NODE_ENV === "production" ? "live" : "test";

// event.data is unfiltered SDK passthrough — can carry secrets (client_secret_key) or customer PII; only these scalars are safe to send to analytics.
const SAFE_EVENT_FIELDS = [
  "currency",
  "total",
  "subTotal",
  "discount",
  "tax",
] as const;

function pickSafeFields(
  data: Record<string, unknown> | undefined,
): Record<string, string | number> {
  if (!data) return {};
  const out: Record<string, string | number> = {};
  for (const key of SAFE_EVENT_FIELDS) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    }
  }
  return out;
}

// Mirrors the allowlist the SDK applies inside buildCheckoutUrl before framing a session URL.
const DODO_CHECKOUT_HOSTS = new Set([
  "checkout.dodopayments.com",
  "test.checkout.dodopayments.com",
]);

function isDodoCheckoutUrl(url: string): boolean {
  try {
    return DODO_CHECKOUT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

let initialized = false;

// SDK's onEvent handler is global; source is stamped here at open time and read by the handler below.
let currentSource = "unknown";

function ensureInitialized() {
  if (initialized) return;

  DodoPayments.Initialize({
    mode: MODE,
    displayType: "overlay",
    onEvent: (event: CheckoutEvent) => {
      posthog.capture(`dodo_${event.event_type.replace(/\./g, "_")}`, {
        source: currentSource,
        ...pickSafeFields(event.data),
      });
    },
  });

  initialized = true;
}

/**
 * Opens the Dodo overlay for a checkout session URL; falls back to a full-page redirect if the SDK throws.
 * @param checkoutUrl `checkout_url` from POST /api/checkout.
 * @param source Funnel position, e.g. "onboarding_paywall" or "upsell_modal".
 */
export function openDodoCheckout(checkoutUrl: string, source: string): void {
  currentSource = source;

  try {
    ensureInitialized();
    // No manualRedirect: overlay navigates to the session's return_url, chosen server-side (see checkout.ts).
    DodoPayments.Checkout.open({ checkoutUrl });
  } catch (err) {
    console.error("[dodo-checkout] overlay failed, falling back:", err);
    posthog.capture("dodo_overlay_failed", { source });

    // Fallback must enforce the same hostname allowlist as the SDK, or it's a weaker path than checkout itself.
    if (!isDodoCheckoutUrl(checkoutUrl)) {
      console.error("[dodo-checkout] refusing redirect to", checkoutUrl);
      return;
    }
    window.location.href = checkoutUrl;
  }
}
