import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetDigest = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["digest"],
    queryFn: async () => {
      const response = await client.api.digest.$get();

      if (!response.ok) throw new Error("Failed to get digest");

      const data = await response.json();
      return data;
    },
    retry: 1,
    refetchInterval: 30 * 1000,
  });
};
