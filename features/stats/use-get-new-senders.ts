import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetNewSenders = (from?: string, to?: string) => {
  const { user } = useUser();
  return useQuery({
    enabled: !!user,
    queryKey: ["stats-new-senders", { from, to }],
    queryFn: async () => {
      const response = await client.api.stats["new-senders"].$get({
        query: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });
      if (!response.ok) throw new Error("failed to get new senders");
      return response.json();
    },
    retry: 1,
  });
};
