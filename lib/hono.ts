import { hc } from "hono/client";

import {AppType} from "@/app/api/[[...route]]/route"
import { TIER_GATE_EVENT, type TierGateDetail } from "./tier-gate-event";

// Collapses id-like segments to :id so path labels carry no user data.
const ID_SEGMENT =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z]+_[A-Za-z0-9]{6,}|[A-Za-z0-9_-]{16,})$/i;

const templatePath = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
    .join("/")
    .slice(0, 120);

const isMutation = (input: RequestInfo | URL, init?: RequestInit): boolean => {
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase() !== "GET";
};

const tierAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);

  // Don't read the body — it would consume the stream the caller still needs.
  // X-Billing-Pending means payment is processing, not that they need to upgrade.
  const billingPending = response.headers.get("X-Billing-Pending") !== null;

  if (
    typeof window !== "undefined" &&
    !billingPending &&
    (response.status === 402 || response.status === 403) &&
    isMutation(input, init)
  ) {
    window.dispatchEvent(
      new CustomEvent(TIER_GATE_EVENT, {
        detail: {
          status: response.status,
          path: templatePath(
            new URL(response.url, window.location.origin).pathname,
          ),
        } satisfies TierGateDetail,
      }),
    );
  }

  return response;
};

export const client = hc<AppType>(process.env.NEXT_PUBLIC_API_URL!, {
  fetch: tierAwareFetch,
});
