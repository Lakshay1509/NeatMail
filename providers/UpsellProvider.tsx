"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import posthog from "posthog-js";
import { SubscriptionModal } from "@/components/SubscriptionModal";
import { useTierAccess } from "@/features/user/use-tier-access";
import { TIER_GATE_EVENT, type TierGateDetail } from "@/lib/tier-gate-event";

// Single mounted modal so direct "Unlock" clicks and API 403 events (lib/hono) never stack two dialogs.
interface UpsellContextValue {
  /** `source` is recorded on the analytics event — keep it specific. */
  openUpsell: (source: string) => void;
}

const UpsellContext = createContext<UpsellContextValue>({
  openUpsell: () => {},
});

export const useUpsell = () => useContext(UpsellContext);

export function UpsellProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const { isFree, isResolved } = useTierAccess();

  const openUpsell = useCallback((source: string) => {
    posthog.capture("upsell_opened", { source });
    setOpen(true);
  }, []);

  useEffect(() => {
    const onTierGate = (event: Event) => {
      // Wait for isResolved: an unresolved tier reads as FREE and would misfire on paying users.
      if (!isResolved || !isFree) return;
      const detail = (event as CustomEvent<TierGateDetail>).detail;
      openUpsell(`api:${detail?.path ?? "unknown"}`);
    };

    window.addEventListener(TIER_GATE_EVENT, onTierGate);
    return () => window.removeEventListener(TIER_GATE_EVENT, onTierGate);
  }, [isFree, openUpsell]);

  return (
    <UpsellContext.Provider value={{ openUpsell }}>
      {children}
      <SubscriptionModal open={open} onOpenChange={setOpen} />
    </UpsellContext.Provider>
  );
}
