import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetDigestCompleted = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["digest-completed"],
    queryFn: async () => {
      const response = await client.api.digest.completed.$get();

      if (!response.ok) throw new Error("Failed to get completed digest");

      const data = await response.json();
      return data;
    },
    retry: 1,
  });
};
