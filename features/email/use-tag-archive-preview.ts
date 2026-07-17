import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

// Count of mail this rule would archive immediately if saved right now.
export const useTagArchivePreview = (
  tagId: string,
  duration: number,
  enabled: boolean,
) => {
  const { user } = useUser();
  return useQuery({
    enabled: !!user && enabled && !!tagId,
    queryKey: ["tag-archive-preview", tagId, duration],
    queryFn: async () => {
      const response = await client.api.email.archive.tag.preview.$get({
        query: { tagId, duration: String(duration) },
      });

      if (!response.ok) throw new Error("failed to load archive preview");

      return (await response.json()) as { count: number };
    },
    staleTime: 30_000,
    retry: 1,
  });
};
