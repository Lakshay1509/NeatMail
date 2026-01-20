import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetScopes = () => {
  const query = useQuery({
    queryKey: ["user-scopes"],
    queryFn: async () => {
      const response = await client.api.user.scopes.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch scopes");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};