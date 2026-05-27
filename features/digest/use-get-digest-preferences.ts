import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetDigestPreferences = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["digest-preferences"],
    queryFn: async () => {
      const response = await client.api.digest.preferences.$get();

      if (!response.ok) throw new Error("Failed to get digest preferences");

      const data = await response.json();
      return data;
    },
    retry: 1,
  });
};
