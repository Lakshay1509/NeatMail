import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

type LastMessageResponse = {
  body: string | null;
  date: string | null;
  subject: string | null;
  is_gmail: boolean;
};

export const useGetLastMessage = (threadId: string | null) => {
  const { user } = useUser();

  return useQuery<LastMessageResponse | null, Error>({
    enabled: !!user && !!threadId,
    queryKey: ["last-message", threadId],
    queryFn: async () => {
      const response = await client.api.email.thread[":threadId"]["last-message"].$get({
        param: { threadId: threadId! },
      });

      if (!response.ok) throw new Error("Failed to get last message");

      return response.json() as Promise<LastMessageResponse | null>;
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
};
