import { useCallback, useState } from "react";
import { InferRequestType } from "hono";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

export interface ChatAttachment {
  key: string
  filename: string
  mimeType: string
}

export interface PendingTarget {
  id: string
  subject: string
  from: string
}

export interface PendingConfirmation {
  id: string
  kind: "trash" | "archive" | "unsubscribe"
  summary: string
  targets: PendingTarget[]
}

export interface SessionInfo {
  sessionId: string
  createdSession: boolean
}

export interface ChatResponse {
  response: string
  attachments: ChatAttachment[]
  pendingConfirmation?: PendingConfirmation
  // server assigns/creates the session, not the client
  sessionId?: string
  createdSession?: boolean
}

export interface ConfirmResponse {
  ok: boolean
  message: string
}

type RequestType = InferRequestType<
  (typeof client.api.chat)["$post"]
>["json"];

export const useChat = () => {
  return useMutation<ChatResponse, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.chat["$post"]({ json });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          (errorData as { message?: string }).message ||
            "Failed to process chat query",
        );
      }

      return response.json();
    },
    onError: (error) => {
      console.error("[useChat]", error);
      toast.error(error.message || "Failed to process chat query");
    },
  });
};

// streaming variant, gives live progress over SSE instead of one big response

interface AgentStatusEvent {
  type: "status";
  label: string;
  tool?: string;
}

// posts to /api/chat/stream and parses the SSE frames by hand (no EventSource,
// we need POST with a body). resolves once the `done` frame comes through.
async function streamChat(
  query: string,
  onStatus: (label: string) => void,
  sessionId?: string,
  onSession?: (info: SessionInfo) => void,
): Promise<ChatResponse> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionId ? { query, sessionId } : { query }),
  });

  // auth/tier/rate-limit failures come back as plain JSON, not SSE
  if (!res.ok || !res.body) {
    let message = "Failed to process chat query";
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResponse | null = null;
  let errorMessage: string | null = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (event === "status") {
      const label = (payload as AgentStatusEvent).label;
      if (label) onStatus(label);
    } else if (event === "session") {
      const info = payload as SessionInfo;
      if (info.sessionId) onSession?.(info);
    } else if (event === "done") {
      result = payload as ChatResponse;
    } else if (event === "error") {
      errorMessage = (payload as { message?: string }).message ?? "Chat processing failed";
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (frame.trim()) handleFrame(frame);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (errorMessage) throw new Error(errorMessage);
  if (!result) throw new Error("The assistant didn't return a response.");
  return result;
}

export const useChatStream = () => {
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = useCallback(
    async (
      query: string,
      sessionId?: string,
      onSession?: (info: SessionInfo) => void,
    ): Promise<ChatResponse> => {
      setIsPending(true);
      setStatus(null);
      try {
        return await streamChat(query, setStatus, sessionId, onSession);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to process chat query";
        console.error("[useChatStream]", err);
        toast.error(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setIsPending(false);
        setStatus(null);
      }
    },
    [],
  );

  return { send, isPending, status };
};

export const useConfirmAction = () => {
  return useMutation<ConfirmResponse, Error, { actionId: string }>({
    mutationFn: async ({ actionId }) => {
      const response = await client.api.chat.confirm["$post"]({
        json: { actionId },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          (errorData as { message?: string }).message ||
            "Failed to confirm action",
        );
      }

      return response.json();
    },
    onError: (error) => {
      console.error("[useConfirmAction]", error);
      toast.error(error.message || "Failed to confirm action");
    },
  });
};
