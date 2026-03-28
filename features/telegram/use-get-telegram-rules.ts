import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetTelegramRules = () => {
  const query = useQuery({
    queryKey: ["user-telegram-rules"],
    queryFn: async () => {
      const response = await client.api.telegram.rules.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch telegram rules");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};