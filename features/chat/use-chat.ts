import { useCallback, useState } from "react";
import { InferRequestType } from "hono";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { notifyTierGate } from "@/lib/tier-gate-event";
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

export interface AgentStatusEvent {
  type: "status";
  label: string;
  doneLabel?: string;
  tool?: string;
}

/** One line in the agent's live trace. */
export interface AgentStep {
  id: number;
  label: string;
  /** Past-tense wording swapped in once the step finishes. */
  doneLabel?: string;
  tool?: string;
  state: "active" | "done";
}

/**
 * Accumulate steps instead of overwriting, so a 30s run reads as visible
 * progress. START/THINKING carry no `tool`; real tool steps do. A no-tool
 * status closes everything before it. A tool status closes only the no-tool
 * ones, because the model fires tools in parallel batches that should read as
 * running concurrently, not as a queue.
 */
export function reduceSteps(prev: AgentStep[], e: AgentStatusEvent): AgentStep[] {
  const isTool = Boolean(e.tool);
  const closed: AgentStep[] = prev.map((s) =>
    !isTool || !s.tool ? { ...s, state: "done" } : s,
  );
  // the same tool twice in one batch is one line, not two
  if (closed.some((s) => s.state === "active" && s.label === e.label)) return closed;
  return [
    ...closed,
    {
      id: (prev[prev.length - 1]?.id ?? -1) + 1,
      label: e.label,
      doneLabel: e.doneLabel,
      tool: e.tool,
      state: "active",
    },
  ];
}

export const closeAll = (prev: AgentStep[]): AgentStep[] =>
  prev.some((s) => s.state === "active")
    ? prev.map((s) => ({ ...s, state: "done" as const }))
    : prev; // same array — no re-render

const LOST_CONNECTION =
  "I lost the connection before the answer arrived. Check your internet and send it again.";
const TOO_SLOW =
  "This is taking too long, so I stopped waiting. Nothing in your mailbox was changed. Please send it again.";

// the page shows err.message verbatim, so browser errors ("Failed to fetch",
// "network error", TimeoutError) get mapped to plain language here
async function streamChat(
  query: string,
  onStatus: (e: AgentStatusEvent) => void,
  onDelta: (text: string) => void,
  sessionId?: string,
  onSession?: (info: SessionInfo) => void,
): Promise<ChatResponse> {
  try {
    return await streamChatRaw(query, onStatus, onDelta, sessionId, onSession);
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError"))
      throw new Error(TOO_SLOW);
    if (err instanceof TypeError) throw new Error(LOST_CONNECTION);
    throw err;
  }
}

// posts to /api/chat/stream and parses the SSE frames by hand (no EventSource,
// we need POST with a body). resolves once the `done` frame comes through.
async function streamChatRaw(
  query: string,
  onStatus: (e: AgentStatusEvent) => void,
  onDelta: (text: string) => void,
  sessionId?: string,
  onSession?: (info: SessionInfo) => void,
): Promise<ChatResponse> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionId ? { query, sessionId } : { query }),
    signal: AbortSignal.timeout(5 * 60_000),
  });

  // auth/tier/rate-limit failures come back as plain JSON, not SSE
  if (!res.ok || !res.body) {
    // SSE bypasses the hono client, so report the plan refusal ourselves.
    notifyTierGate(res.status, "/api/chat/stream");

    if (res.status === 429)
      throw new Error("You're sending messages faster than I can keep up. Wait a minute and try again.");
    let message = "Something went wrong on our side. Nothing in your mailbox was changed. Please try again.";
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
      const e = payload as AgentStatusEvent;
      if (e.label) onStatus(e);
      // anything streamed before a tool step was a preamble, not the answer
      onDelta("");
    } else if (event === "delta") {
      const text = (payload as { text?: string }).text;
      if (text) onDelta(text);
    } else if (event === "session") {
      const info = payload as SessionInfo;
      if (info.sessionId) onSession?.(info);
    } else if (event === "done") {
      result = payload as ChatResponse;
    } else if (event === "error") {
      errorMessage =
        (payload as { message?: string }).message ??
        "Something went wrong on our side. Nothing in your mailbox was changed. Please try again.";
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
  if (!result) throw new Error(LOST_CONNECTION);
  return result;
}

export const useChatStream = () => {
  const [isPending, setIsPending] = useState(false);
  // the agent's trace for the current (or most recent) run
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // the answer as it is being written; "" from onDelta resets it
  const [partial, setPartial] = useState("");

  const send = useCallback(
    async (
      query: string,
      sessionId?: string,
      onSession?: (info: SessionInfo) => void,
    ): Promise<ChatResponse & { steps: AgentStep[]; durationMs: number }> => {
      setIsPending(true);
      // the trace is accumulated locally (same pattern as the delta buffer)
      // and mirrored into state for rendering, so `send` can hand the caller
      // the finished trace without reading back through a stale closure
      let trace: AgentStep[] = [];
      const began = Date.now();
      setSteps(trace);
      setStartedAt(began);
      setPartial("");

      // Flush at ~20fps instead of once per token — a state update per token
      // repaints the whole thread and janks on a long conversation.
      let buffer = "";
      let flush: ReturnType<typeof setTimeout> | null = null;
      const onDelta = (text: string) => {
        if (flush) clearTimeout(flush);
        if (!text) {
          buffer = "";
          flush = null;
          setPartial("");
          return;
        }
        buffer += text;
        // the answer has started, so every step behind it is finished
        const closed = closeAll(trace);
        if (closed !== trace) {
          trace = closed;
          setSteps(trace);
        }
        flush = setTimeout(() => setPartial(buffer), 50);
      };

      const onStatus = (e: AgentStatusEvent) => {
        trace = reduceSteps(trace, e);
        setSteps(trace);
      };

      try {
        const res = await streamChat(query, onStatus, onDelta, sessionId, onSession);
        return {
          ...res,
          steps: trace.map((s) => ({ ...s, state: "done" as const })),
          durationMs: Date.now() - began,
        };
      } catch (err) {
        // no toast: the page puts err.message in the reply bubble
        console.error("[useChatStream]", err);
        throw err instanceof Error ? err : new Error(LOST_CONNECTION);
      } finally {
        if (flush) clearTimeout(flush);
        setSteps(closeAll(trace));
        setIsPending(false);
        setPartial("");
      }
    },
    [],
  );

  return { send, isPending, steps, startedAt, partial };
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
