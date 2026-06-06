import { useGetUserSubscribed } from "./use-get-subscribed";
import { TIER_LIMITS, type Tier } from "@/lib/tiers";

export interface TierAccess {
  tier: Tier;
  limits: (typeof TIER_LIMITS)[Tier];
  isLoading: boolean;
  isFree: boolean;
  isPro: boolean;
  isMax: boolean;
}

export function useTierAccess(): TierAccess {
  const { data, isLoading } = useGetUserSubscribed();
  const tier: Tier = (data?.tier as Tier) ?? "FREE";

  return {
    tier,
    limits: TIER_LIMITS[tier],
    isLoading,
    isFree: tier === "FREE",
    isPro: tier === "PRO",
    isMax: tier === "MAX",
  };
}
