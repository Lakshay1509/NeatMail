import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { client } from "@/lib/hono";

export interface ReferralCodeResponse {
  code: string;
  link: string;
  monthsGranted: number;
  monthsRemaining: number;
  monthsCap: number;
}

// dates come back as ISO strings, not Date objects
export interface ReferralRow {
  id: string;
  status: "PENDING" | "REWARDED" | "CAPPED" | "REVOKED";
  created_at: string;
}

export const useReferralCode = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["referral-code"],
    queryFn: async (): Promise<ReferralCodeResponse> => {
      const response = await client.api.referral.code.$get();
      if (!response.ok) throw new Error("Failed to load referral code");
      return (await response.json()) as ReferralCodeResponse;
    },
    retry: 1,
  });
};

// Has the current user been referred by someone else? Backs the "you've been
// referred, enjoy 14 days" onboarding messaging.
export const useIncomingReferral = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["referral-incoming"],
    queryFn: async (): Promise<{ referred: boolean }> => {
      const response = await client.api.referral.incoming.$get();
      if (!response.ok) throw new Error("Failed to check referral status");
      return (await response.json()) as { referred: boolean };
    },
    retry: 1,
  });
};

export const useReferralStatus = (limit = 10) => {
  const { user } = useUser();

  return useInfiniteQuery({
    enabled: !!user,
    queryKey: ["referral-status", { limit }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.api.referral.status.$get({
        query: {
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      if (!response.ok) throw new Error("Failed to load referral history");
      return (await response.json()) as {
        referrals: ReferralRow[];
        nextCursor: string | null;
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: 1,
  });
};
