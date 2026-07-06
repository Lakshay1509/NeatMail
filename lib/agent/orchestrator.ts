import OpenAI from "openai";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { redis } from "../redis";
import { buildSystemPrompt } from "./prompt";
import { buildTools } from "./tools";
import { statusForTool, START_STATUS, THINKING_STATUS } from "./progress";
import type { AgentEvent } from "./progress";
import { GmailProvider } from "./providers/gmail";
import { OutlookProvider } from "./providers/outlook";
import { getAttachment as getStoredAttachment } from "../chat/attachment-store";
import { decrypt } from "@/lib/encode";
import {
  loadPendingAction,
  loadAnyPendingAction,
  clearPendingAction,
  partitionSeen,
} from "./guardrails";
import type {
  AgentResult,
  DraftPrefs,
  MailProvider,
  PendingAction,
  ToolContext,
} from "./types";

const openai = new OpenAI({
  baseURL: process.env.AZURE_ENDPOINT!,
  apiKey: process.env.AZURE_API_KEY!,
});

const MODEL = "gpt-5-mini";
const MAX_ITERATIONS = 8;
const HISTORY_LIMIT = 8;

// bold/heading/list/table/code — if none of these show up the reply is plain prose
const MARKDOWN_MARKER =
  /(\*\*[^*]+\*\*|__[^_]+__|^#{1,6}\s|^[-*+]\s|^\d+\.\s|`[^`]+`|\|.*\|)/m;

// prompt already asks for markdown but every so often the model just ignores
// it, so patch up long unformatted replies with a cheap second pass. skip
// short stuff like "Done." — nothing there needs bolding anyway.
async function ensureMarkdown(text: string): Promise<string> {
  if (text.length < 120 || MARKDOWN_MARKER.test(text)) return text;
  try {
    const repair = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 2000,
      messages: [
        {
          role: "system",
          content:
            "Reformat the user's message using markdown: bold key facts and numbers, bullet or numbered lists for multiple points, and a table (Sender | Subject | Date) if it lists emails. Do not change the meaning, or add or remove any information. Return only the reformatted text.",
        },
        { role: "user", content: text },
      ],
    });
    return repair.choices[0].message.content?.trim() || text;
  } catch (err) {
    console.error("[agent] markdown repair failed", err);
    return text;
  }
}

// the chat agent: tool-calling loop over gpt-5-mini, provider-agnostic
// (gmail/outlook), confirm-before-destroy for anything irreversible.
// caller (HTTP route / telegram worker) formats the returned AgentResult.
export async function runAgent(
  userQuery: string,
  userId: string,
  isGmail: boolean,
  channel = "api",
  onEvent?: (e: AgentEvent) => void,
  sessionId?: string,
): Promise<AgentResult> {
  const emit = (label: string, tool?: string) =>
    onEvent?.({ type: "status", label, tool });
  emit(START_STATUS);

  const provider: MailProvider = isGmail
    ? new GmailProvider(userId)
    : new OutlookProvider(userId);

  // Draft styling + timezone + display name (all best-effort, non-fatal).
  let prefsRow: {
    fontColor: string;
    fontSize: number;
    signature: string | null;
    timezone: string | null;
  } | null = null;
  let userName: string | null = null;
  try {
    [prefsRow, userName] = await Promise.all([
      db.draft_preference.findUnique({
        where: { user_id: userId },
        select: { fontColor: true, fontSize: true, signature: true, timezone: true },
      }),
      clerkClient()
        .then((c) => c.users.getUser(userId))
        .then((u) => u.fullName)
        .catch(() => null),
    ]);
  } catch (err) {
    console.error("[agent] preload failed", err);
  }

  const timezone = prefsRow?.timezone || "UTC";
  const prefs: DraftPrefs = {
    fontColor: prefsRow?.fontColor ?? "#000000",
    fontSize: prefsRow?.fontSize ?? 14,
    signature: prefsRow?.signature ?? null,
  };

  const attachmentKeys: string[] = [];
  const ctx: ToolContext = {
    userId,
    provider,
    channel,
    timezone,
    attachmentKeys,
    getPrefs: async () => prefs,
    pending: null,
  };

  const tools = buildTools(provider.kind);
  const toolMap = new Map(tools.map((t) => [t.schema.function.name, t]));
  const toolSchemas = tools.map((t) => t.schema);

  // web chats get their own history per session; telegram has no concept of
  // sessions so it just keeps one rolling buffer per user. a new web chat's
  // first message has no sessionId yet, so there's nothing to key on.
  const historyKey = sessionId
    ? `agent:history:${userId}:${sessionId}`
    : channel !== "api"
      ? `agent:history:${userId}`
      : null;

  let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (historyKey) {
    try {
      const raw = await redis.get(historyKey);
      if (typeof raw === "string") history = JSON.parse(raw);
    } catch (err) {
      console.error("[agent] history load failed", err);
    }
  }

  // redis cache is empty but we have a sessionId — either it's an old chat
  // being reopened or the 1h TTL just lapsed. pull the history back from
  // postgres instead of losing context.
  if (history.length === 0 && sessionId) {
    try {
      const rows = await db.chatMessage.findMany({
        where: { session_id: sessionId, session: { user_id: userId } },
        orderBy: { created_at: "desc" },
        take: HISTORY_LIMIT,
        select: { is_user: true, content: true },
      });
      history = await Promise.all(
        rows.reverse().map(async (r) => ({
          role: r.is_user ? ("user" as const) : ("assistant" as const),
          content: await decrypt(r.content),
        })),
      );
    } catch (err) {
      console.error("[agent] history hydrate failed", err);
    }
  }

  // avoid double-adding: if we just hydrated from postgres, the row for this
  // exact query may already be in there (saved by the route handler in parallel)
  const lastTurn = history[history.length - 1];
  if (
    !lastTurn ||
    lastTurn.role !== "user" ||
    lastTurn.content !== userQuery
  ) {
    history.push({ role: "user", content: userQuery });
  }
  if (history.length > HISTORY_LIMIT)
    history = history.slice(history.length - HISTORY_LIMIT);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        kind: provider.kind,
        userName,
        timezone,
        today: new Date().toISOString().split("T")[0],
      }),
    },
    ...history,
  ];

  let finalAnswer = "No answer generated.";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "medium",
      tools: toolSchemas,
      tool_choice: "auto",
      max_completion_tokens: 3000,
      messages,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalAnswer = message.content?.trim() || "No answer generated.";
      break;
    }

    // Surface what's about to run. When the model batches several tools, the
    // last label wins on screen — fine, they fire near-simultaneously.
    for (const tc of message.tool_calls) {
      if (tc.type === "function") emit(statusForTool(tc.function.name), tc.function.name);
    }

    const toolResults = await Promise.all(
      message.tool_calls
        .filter((tc) => tc.type === "function")
        .map(async (tc) => {
          let content: string;
          try {
            const tool = toolMap.get(tc.function.name);
            if (!tool) {
              content = `Unknown tool: ${tc.function.name}`;
            } else {
              const args = tc.function.arguments
                ? JSON.parse(tc.function.arguments)
                : {};
              content = await tool.handler(args, ctx);
            }
          } catch (err) {
            content = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          return { role: "tool" as const, tool_call_id: tc.id, content };
        }),
    );
    messages.push(...toolResults);

    // Not the last hop — the model will now reason over these results.
    if (i < MAX_ITERATIONS - 1) emit(THINKING_STATUS);

    if (i === MAX_ITERATIONS - 1) {
      finalAnswer =
        message.content?.trim() ||
        "I did part of that but ran out of steps — try narrowing the request.";
    }
  }

  finalAnswer = await ensureMarkdown(finalAnswer);

  // only cache the user query + final answer, not the tool call traffic in
  // between. (first turn of a new chat has no historyKey yet — fine, next
  // turn rebuilds from postgres anyway)
  history.push({ role: "assistant", content: finalAnswer });
  if (history.length > HISTORY_LIMIT)
    history = history.slice(history.length - HISTORY_LIMIT);
  if (historyKey) {
    redis
      .setex(historyKey, 3600, JSON.stringify(history))
      .catch((err) => console.error("[agent] history save failed", err));
  }

  const attachments = attachmentKeys
    .map((key) => {
      const meta = getStoredAttachment(key);
      return meta ? { key, filename: meta.filename, mimeType: meta.mimeType } : null;
    })
    .filter(Boolean) as AgentResult["attachments"];

  const result: AgentResult = { response: finalAnswer, attachments };
  if (ctx.pending) {
    result.pendingConfirmation = {
      id: ctx.pending.id,
      kind: ctx.pending.kind,
      summary: ctx.pending.summary,
      targets: ctx.pending.targets,
    };
  }
  return result;
}

async function runPendingAction(
  userId: string,
  isGmail: boolean,
  action: PendingAction,
): Promise<{ ok: boolean; message: string }> {
  const provider: MailProvider = isGmail
    ? new GmailProvider(userId)
    : new OutlookProvider(userId);

  const ids = action.targets.map((t) => t.id);
  // Re-validate against the seen set — never act on ids that aren't grounded.
  const { seen } = await partitionSeen(userId, ids);
  if (seen.length === 0) {
    await clearPendingAction(userId);
    return { ok: false, message: "Could not verify those emails — nothing changed." };
  }

  try {
    let message: string;
    if (action.kind === "trash") {
      const r = await provider.trash(seen);
      message = `Moved ${r.count} email${r.count === 1 ? "" : "s"} to trash.`;
    } else if (action.kind === "archive") {
      const r = await provider.archive(seen);
      message = `Archived ${r.count} email${r.count === 1 ? "" : "s"}.`;
    } else {
      const r = await provider.unsubscribe(seen[0]);
      message =
        r.requiresRedirect && r.redirectUrl
          ? `To finish unsubscribing, open: ${r.redirectUrl}`
          : r.success
            ? "Unsubscribed."
            : "Couldn't complete the unsubscribe automatically.";
    }
    await clearPendingAction(userId);
    return { ok: true, message };
  } catch (err) {
    await clearPendingAction(userId);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Action failed.",
    };
  }
}

/** Execute a specific staged action after the user confirms (web /confirm). */
export async function executeConfirmedAction(
  userId: string,
  isGmail: boolean,
  actionId: string,
): Promise<{ ok: boolean; message: string }> {
  const action = await loadPendingAction(userId, actionId);
  if (!action) {
    return { ok: false, message: "That action expired or was already handled." };
  }
  return runPendingAction(userId, isGmail, action);
}

/** Execute whatever action is staged (Telegram "confirm" reply). */
export async function executeLatestPending(
  userId: string,
  isGmail: boolean,
): Promise<{ ok: boolean; message: string }> {
  const action = await loadAnyPendingAction(userId);
  if (!action) {
    return { ok: false, message: "Nothing is waiting for confirmation." };
  }
  return runPendingAction(userId, isGmail, action);
}
