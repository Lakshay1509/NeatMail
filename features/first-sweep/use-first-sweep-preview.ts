import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export interface FirstSweepBucket {
  key: string;
  label: string;
  count: number;
}

export interface FirstSweepPreview {
  eligible: boolean;
  alreadySwept: boolean;
  isGmail: boolean;
  total: number;
  buckets: FirstSweepBucket[];
}

// Backs the dashboard "Kaboom" banner. Cheap on the server (Gmail's own counts,
// no message bodies, no AI), so it's fine to fetch on every dashboard load.
export const useFirstSweepPreview = () => {
  const { user } = useUser();
  return useQuery({
    enabled: !!user,
    queryKey: ["first-sweep-preview"],
    queryFn: async (): Promise<FirstSweepPreview> => {
      const response = await client.api["first-sweep"].preview.$get();
      if (!response.ok) throw new Error("failed to load inbox sweep preview");
      return (await response.json()) as FirstSweepPreview;
    },
    // The banner is a one-time thing — don't refetch aggressively.
    staleTime: 5 * 60_000,
    retry: 1,
  });
};
