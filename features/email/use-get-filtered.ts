import { useInfiniteQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetFilteredEmails = (
  after: string | undefined,
  before: string | undefined,
  largerThan: number,
  maxResults?: number,
  from?: string,
  to?: string,
) => {
  const { user } = useUser();

  const query = useInfiniteQuery({
    enabled: !!user && !!after && !!before && !!largerThan,
    queryKey: ["filtered-emails", { after, before, largerThan, maxResults, from, to }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.api.email.filtered.$get({
        query: {
          after,
          before,
          largerThan: largerThan.toString(),
          ...(pageParam ? { pageToken: pageParam } : {}),
          ...(maxResults ? { maxResults: maxResults.toString() } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });

      if (!response.ok) throw new Error("Failed to get filtered emails");

      const data = await response.json();
      return data as { emails: EmailRow[]; nextPageToken?: string };
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    retry: 1,
  });

  return query;
};

export type EmailRow = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  sizeEstimate: number;
};
