import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetOverview = (from?: string, to?: string) => {
  const { user } = useUser();
  const query = useQuery({
    enabled: !!user,
    queryKey: ["stats-overview", { from, to }],
    queryFn: async () => {
      const response = await client.api.stats.overview.$get({
        query: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });

      if (!response.ok) throw new Error("failed to get overview stats");

      const data = await response.json();
      return data;
    },
    retry: 1,
  });

  return query;
};
