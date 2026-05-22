import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";

export const useGetIntegrationStatus = (provider: string) => {
  const query = useQuery({
    queryKey: ["integration-status", provider],
    queryFn: async () => {
      const response = await client.api.integrations[":provider"].$get({
        param: { provider },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch integration status");
      }

      const data = await response.json();
      return data;
    },
    enabled: !!provider,
  });

  return query;
};
