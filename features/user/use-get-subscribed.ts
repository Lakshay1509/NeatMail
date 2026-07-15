import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";
import type { Tier } from "@/lib/tiers";

export interface UserSubscriptionResponse {
  success: boolean;
  subscribed: boolean;
  tier: Tier;
  status?: string;
  price?: number;
  /** Billing currency of the subscription — show prices from this, not from geo. */
  currency?: string;
  interval?: "monthly" | "annual";
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean | null;
  freeTrial: boolean;
  extraMailboxes: number;
  paymentProcessing: boolean;
}

export const useGetUserSubscribed = () => {
  const { user } = useUser();
  const query = useQuery({
    enabled: !!user,
    queryKey: ["user-subscription"],
    queryFn: async (): Promise<UserSubscriptionResponse> => {
      const response = await client.api.user.subscription.$get();

      if (!response.ok) throw new Error("failed to get user subscription");

      const data = await response.json();

      return data as UserSubscriptionResponse;
    },
    retry: 1,
  });

  return query;
};
