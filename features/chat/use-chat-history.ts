import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { client } from "@/lib/hono";

// dates come back as ISO strings, not Date objects
export interface ChatSessionSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  is_user: boolean;
  content: string;
  created_at: string;
}

// hono's ClientResponse isn't a real fetch Response, so just type the couple
// of fields we actually touch instead of fighting its generics
type ErrorLikeResponse = { status: number; json: () => Promise<unknown> };

async function friendlyError(
  response: ErrorLikeResponse,
  fallback: string,
): Promise<string> {
  let body: { error?: string; message?: string } = {};
  try {
    body = (await response.json()) as { error?: string; message?: string };
  } catch {
    /* not JSON, fall back to the status code switch below */
  }

  switch (response.status) {
    case 401:
      return "Please sign in again to continue.";
    case 402:
      return "AI chat is available on the Pro and Max plans. Upgrade to keep chatting.";
    case 403:
      return "You don't have access to this conversation.";
    case 404:
      return body.error === "Session not found"
        ? "This conversation no longer exists. It may have been deleted."
        : "We couldn't find what you were looking for.";
    case 429:
      return "You're going a little fast — please wait a moment and try again.";
    default:
      if (response.status >= 500)
        return "Something went wrong on our end. Please try again in a moment.";
      return body.message || body.error || fallback;
  }
}

// v5 removed per-query onError, so this is the replacement — the thrown
// Error already has the friendly text from friendlyError() above
function useErrorToast(isError: boolean, error: unknown, fallback: string) {
  useEffect(() => {
    if (!isError) return;
    const message =
      error instanceof Error && error.message ? error.message : fallback;
    toast.error(message);
  }, [isError, error, fallback]);
}

export const useChatSessions = (limit = 20, enabled = true) => {
  const { user } = useUser();

  const query = useInfiniteQuery({
    enabled: !!user && enabled,
    queryKey: ["chat-sessions", { limit }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.api.chat.sessions.$get({
        query: {
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(
          await friendlyError(response, "Couldn't load your conversations."),
        );
      }

      return (await response.json()) as {
        sessions: ChatSessionSummary[];
        nextCursor: string | null;
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: 1,
  });

  useErrorToast(query.isError, query.error, "Couldn't load your conversations.");
  return query;
};

export const useChatMessages = (
  sessionId: string | undefined,
  limit = 50,
  enabled = true,
) => {
  const { user } = useUser();

  const query = useInfiniteQuery({
    enabled: !!user && !!sessionId && enabled,
    queryKey: ["chat-messages", sessionId, { limit }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.api.chat.sessions[":sessionId"].messages.$get(
        {
          param: { sessionId: sessionId! },
          query: {
            limit: String(limit),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          await friendlyError(response, "Couldn't load this conversation."),
        );
      }

      return (await response.json()) as {
        messages: ChatMessageRow[];
        nextCursor: string | null;
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: 1,
  });

  useErrorToast(query.isError, query.error, "Couldn't load this conversation.");
  return query;
};

// the /api/chat/stream route saves both turns itself now — nothing here writes messages
