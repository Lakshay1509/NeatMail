import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";

// See GET /api/onboard/reveal.
export type OnboardReveal =
  | { status: "pending" }
  | { status: "done"; sendersMuted: number; emailsSilenced: number };

// `enabled` should flip true only once POST /api/onboard has succeeded,
// since that's what enqueues the scan this polls for.
export function useOnboardReveal(enabled: boolean) {
  return useQuery<OnboardReveal>({
    queryKey: ["onboard-reveal"],
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // The endpoint degrades errors to "done" itself, so no retry storm here.
    refetchInterval: (query) =>
      query.state.data?.status === "done" ? false : 1200,
    queryFn: async () => {
      const res = await client.api.onboard.reveal.$get();
      if (!res.ok) throw new Error("Failed to load onboarding reveal");
      return (await res.json()) as OnboardReveal;
    },
  });
}
