import { useGetUserSubscribed } from "./use-get-subscribed";
import { TIER_LIMITS, type Tier } from "@/lib/tiers";

export interface TierAccess {
  tier: Tier;
  limits: (typeof TIER_LIMITS)[Tier];
  isLoading: boolean;
  isFree: boolean;
  isPro: boolean;
  isMax: boolean;
  /** True once the server has confirmed the tier. `tier` defaults to FREE while loading/erroring — fine for withholding a feature, wrong for claiming the user is unsubscribed. Gate any such claim on this, not isFree. */
  isResolved: boolean;
}

export function useTierAccess(): TierAccess {
  const { data, isLoading, isError } = useGetUserSubscribed();
  const tier: Tier = (data?.tier as Tier) ?? "FREE";

  return {
    tier,
    limits: TIER_LIMITS[tier],
    isLoading,
    isFree: tier === "FREE",
    isPro: tier === "PRO",
    isMax: tier === "MAX",
    isResolved: !isLoading && !isError && !!data,
  };
}
