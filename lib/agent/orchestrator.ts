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

/**
 * The NeatMail chat agent. A capable model (gpt-5-mini, medium reasoning) drives
 * a provider-agnostic tool loop with hard grounding + confirm-before-destroy.
 * Returns structured data; the HTTP layer / Telegram worker format it.
 */
export async function runAgent(
  userQuery: string,
  userId: string,
  isGmail: boolean,
  channel = "api",
  onEvent?: (e: AgentEvent) => void,
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

  // ── History (last HISTORY_LIMIT user/assistant turns) ──
  const historyKey = `agent:history:${userId}`;
  let history: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  try {
    const raw = await redis.get(historyKey);
    if (typeof raw === "string") history = JSON.parse(raw);
  } catch (err) {
    console.error("[agent] history load failed", err);
  }
  history.push({ role: "user", content: userQuery });
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

  // Persist only the user turn + final answer (not tool traffic).
  history.push({ role: "assistant", content: finalAnswer });
  if (history.length > HISTORY_LIMIT)
    history = history.slice(history.length - HISTORY_LIMIT);
  redis
    .setex(historyKey, 3600, JSON.stringify(history))
    .catch((err) => console.error("[agent] history save failed", err));

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
