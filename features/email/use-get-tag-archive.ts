import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetTagArchiveRules = () => {
  const { user } = useUser();
  const query = useQuery({
    enabled: !!user,
    queryKey: ["tag-archive-rules"],
    queryFn: async () => {
      const response = await client.api.email.archive.tag.$get();

      if (!response.ok) throw new Error("failed to get tag archive rules");

      return await response.json();
    },
    retry: 1,
  });

  return query;
};
