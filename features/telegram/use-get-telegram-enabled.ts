import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetTelegramEnabled = () => {
  const query = useQuery({
    queryKey: ["user-telegram-enabled"],
    queryFn: async () => {
      const response = await client.api.telegram.enabled.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch telegram status");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};