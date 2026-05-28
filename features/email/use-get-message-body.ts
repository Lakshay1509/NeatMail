import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

type MessageBodyResponse = {
  body: string;
};

export const useGetMessageBody = (messageId: string | null) => {
  const { user } = useUser();

  return useQuery<MessageBodyResponse, Error>({
    enabled: !!user && !!messageId,
    queryKey: ["message-body", messageId],
    queryFn: async () => {
      const response = await client.api.email.body[":messageId"].$get({
        param: { messageId: messageId! },
      });

      if (!response.ok) throw new Error("Failed to get message body");

      return response.json() as Promise<MessageBodyResponse>;
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
};
