import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetUnreadBreakdown = (from?: string, to?: string) => {
  const { user } = useUser();
  return useQuery({
    enabled: !!user,
    queryKey: ["stats-unread-by-label", { from, to }],
    queryFn: async () => {
      const response = await client.api.stats["unread-by-label"].$get({
        query: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });
      if (!response.ok) throw new Error("failed to get unread breakdown");
      return response.json();
    },
    retry: 1,
  });
};
