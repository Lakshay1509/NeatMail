import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";

export const useGetSlackEnabled = () => {
  const query = useQuery({
    queryKey: ["user-slack-enabled"],
    queryFn: async () => {
      const response = await client.api.slack.enabled.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch slack status");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};
