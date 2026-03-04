import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetDefaultUser = () => {
  const query = useQuery({
    queryKey: ["user-default"],
    queryFn: async () => {
      const response = await client.api.user.default.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch default user");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};