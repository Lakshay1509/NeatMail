import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";

export const useGetTelegramPreferences = () => {
  const query = useQuery({
    queryKey: ["user-telegram-preferences"],
    queryFn: async () => {
      const response = await client.api.telegram.prefernces.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch telegram preferences");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};
