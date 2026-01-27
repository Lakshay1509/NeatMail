import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetUserWallet = () => {
  const query = useQuery({
    queryKey: ["user-wallet"],
    queryFn: async () => {
      const response = await client.api.user.walletBalance.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch wallet balance");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};