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
import { friendlyError } from "./errors";
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

// SDK default is a 10-minute timeout per attempt, which reads as a frozen chat
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  timeout: 90_000,
  maxRetries: 1,
});

const MODEL = "gpt-5-mini";
const MAX_ITERATIONS = 8;
const MAX_COMPLETION_TOKENS = 8000;
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
  // only scripts/agent-eval.ts passes this — a fake inbox so the whole loop
  // (prompt, tools, guardrails) can be exercised without touching a mailbox
  providerOverride?: MailProvider,
): Promise<AgentResult> {
  const emit = (label: string, tool?: string) =>
    onEvent?.({ type: "status", label, tool });
  emit(START_STATUS);

  const provider: MailProvider =
    providerOverride ??
    (isGmail ? new GmailProvider(userId) : new OutlookProvider(userId));

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
    userQuery,
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
        channel,
      }),
    },
    ...history,
  ];

  let finalAnswer: string | null = null;
  // set when a tool hits something retrying can't fix (e.g. expired login)
  let fatal: string | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "medium",
      tools: toolSchemas,
      tool_choice: "auto",
      // reasoning tokens count against this; 3000 left big reviews with empty content
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages,
    });

    const message = response.choices[0].message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // empty content = reasoning used up the token budget; the wrap-up
      // below retries instead of showing a blank answer
      finalAnswer = message.content?.trim() || null;
      break;
    }
    messages.push(message);

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
            console.error(`[agent] tool ${tc.function.name} failed`, err);
            if (err instanceof SyntaxError) {
              content = "Error: your arguments were not valid JSON. Call the tool again with valid JSON.";
            } else {
              const f = friendlyError(err, provider.kind);
              if (f.fatal) fatal ??= f.message;
              content = `Error: ${f.message}`;
            }
          }
          return { role: "tool" as const, tool_call_id: tc.id, content };
        }),
    );
    messages.push(...toolResults);
    if (fatal) break;
    emit(THINKING_STATUS);
  }

  if (fatal) {
    finalAnswer = fatal;
  } else if (finalAnswer === null) {
    // Out of tool steps (or the last reply came back empty): answer from
    // everything gathered so far instead of a canned "ran out of steps".
    emit(THINKING_STATUS);
    const wrapUp = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: "low",
      tools: toolSchemas,
      tool_choice: "none",
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "Tool budget exhausted. Answer the user now using only the tool results above. If part of the request wasn't covered, say which part in one short line at the end.",
        },
      ],
    });
    finalAnswer =
      wrapUp.choices[0].message.content?.trim() ||
      "Sorry, I couldn't finish writing that answer. Please send it again, or split it into two smaller questions.";
  }
  // telegram renders HTML, not markdown; error copy is already final
  if (!fatal && channel === "api") finalAnswer = await ensureMarkdown(finalAnswer);

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
  providerOverride?: MailProvider,
): Promise<{ ok: boolean; message: string }> {
  const provider: MailProvider =
    providerOverride ??
    (isGmail ? new GmailProvider(userId) : new OutlookProvider(userId));

  const ids = action.targets.map((t) => t.id);
  // Re-validate against the seen set — never act on ids that aren't grounded.
  const { seen } = await partitionSeen(userId, ids);
  if (seen.length === 0) {
    await clearPendingAction(userId);
    return {
      ok: false,
      message: "This request expired, so nothing was changed. Ask me again and I'll set it up fresh.",
    };
  }

  const plural = (n: number) => `${n} email${n === 1 ? "" : "s"}`;
  try {
    let result: { ok: boolean; message: string };
    if (action.kind === "unsubscribe") {
      const r = await provider.unsubscribe(seen[0]);
      result =
        r.requiresRedirect && r.redirectUrl
          ? { ok: true, message: `Almost done: [open the unsubscribe page](${r.redirectUrl}) to finish.` }
          : r.success
            ? { ok: true, message: "Unsubscribed." }
            : {
                ok: false,
                message:
                  "This sender doesn't support one-click unsubscribe. Open one of their emails and use the unsubscribe link at the bottom, or ask me to archive everything from them.",
              };
    } else {
      const r =
        action.kind === "trash" ? await provider.trash(seen) : await provider.archive(seen);
      const done = action.kind === "trash" ? "moved to trash" : "archived";
      result =
        r.count === 0
          ? {
              ok: false,
              message: `None of those emails could be ${done}, so nothing was changed. They may already be gone. Try again in a minute.`,
            }
          : r.count < seen.length
            ? {
                ok: true,
                message: `${plural(r.count)} ${done}. ${plural(seen.length - r.count)} couldn't be; they may already be gone.`,
              }
            : { ok: true, message: `${plural(r.count)} ${done}.` };
    }
    await clearPendingAction(userId);
    return result;
  } catch (err) {
    console.error("[agent] confirmed action failed", err);
    await clearPendingAction(userId);
    return {
      ok: false,
      message: friendlyError(err, isGmail ? "gmail" : "outlook").message,
    };
  }
}

/** Execute a specific staged action after the user confirms (web /confirm). */
export async function executeConfirmedAction(
  userId: string,
  isGmail: boolean,
  actionId: string,
  providerOverride?: MailProvider,
): Promise<{ ok: boolean; message: string }> {
  const action = await loadPendingAction(userId, actionId);
  if (!action) {
    return {
      ok: false,
      message:
        "This request expired (confirmations last 10 minutes) or was already done, so nothing changed. Ask me again and I'll set it up fresh.",
    };
  }
  return runPendingAction(userId, isGmail, action, providerOverride);
}

/** Execute whatever action is staged (Telegram "confirm" reply). */
export async function executeLatestPending(
  userId: string,
  isGmail: boolean,
): Promise<{ ok: boolean; message: string }> {
  const action = await loadAnyPendingAction(userId);
  if (!action) {
    return {
      ok: false,
      message:
        "There's nothing waiting for your OK. Confirmations expire after 10 minutes, so tell me again what you'd like to clean up and I'll set it up.",
    };
  }
  return runPendingAction(userId, isGmail, action);
}
