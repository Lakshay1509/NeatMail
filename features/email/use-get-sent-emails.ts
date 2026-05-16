import { useInfiniteQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export type SentEmail = {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
};

type SentEmailsResponse = {
  data: SentEmail[];
  nextPageToken?: string;
  is_gmail: boolean;
};

export const useGetSentEmails = (maxResults?: number, olderThan?: number) => {
  const { user } = useUser();

  const query = useInfiniteQuery<SentEmailsResponse, Error>({
    enabled: !!user,
    queryKey: ["sent-emails", { maxResults, olderThan }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.api.email.sent.$get({
        query: {
          ...(maxResults ? { maxResults: maxResults.toString() } : {}),
          ...(olderThan ? { olderThan: olderThan.toString() } : {}),
          ...(pageParam ? { pageToken: pageParam } : {}),
        },
      });

      if (!response.ok) throw new Error("Failed to get sent emails");

      const data = (await response.json()) as SentEmailsResponse;
      return data;
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    retry: 1,
  });

  return query;
};
