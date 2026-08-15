// Keep this free of component imports — lib/hono depends on it too.
export const TIER_GATE_EVENT = "neatmail:tier-gate";

export interface TierGateDetail {
  status: number;
  path: string;
}

// For call sites that bypass lib/hono (e.g. SSE) and must report gate failures themselves.
export function notifyTierGate(status: number, path: string): void {
  if (typeof window === "undefined") return;
  if (status !== 402 && status !== 403) return;
  const detail: TierGateDetail = { status, path };
  window.dispatchEvent(new CustomEvent(TIER_GATE_EVENT, { detail }));
}
