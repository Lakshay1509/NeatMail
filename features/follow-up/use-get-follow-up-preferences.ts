import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetFollowUpPreferences = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["follow-up-preferences"],
    queryFn: async () => {
      const response = await client.api["follow-up"].preferences.$get();

      if (!response.ok) throw new Error("Failed to get follow-up preferences");

      const data = await response.json();
      return data;
    },
    retry: 1,
  });
};
