import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { checkFeatureAccess } from "@/lib/tier-guard";
import { runAgent, executeConfirmedAction } from "@/lib/agent/orchestrator";
import { getAttachment } from "@/lib/chat/attachment-store";
import { friendlyError } from "@/lib/agent/errors";
import {
  resolveChatSession,
  saveUserMessage,
  saveAssistantMessage,
  generateAndSaveTitle,
} from "@/lib/chat/persist";
import { decrypt } from "@/lib/encode";

const querySchema = z.object({
  query: z.string().min(1).max(2000),
  // omitted on the first message of a new chat
  sessionId: z.string().uuid().optional(),
});

const confirmSchema = z.object({
  actionId: z.string().min(1),
});

// cursor = id of the last row from the previous page
const listSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

const listMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

const SESSION_GONE = {
  error: "Session not found",
  message: "This chat isn't available anymore. Start a new chat to keep going.",
};

async function requireChatAccess() {
  const { userId } = await auth();
  if (!userId)
    return {
      error: "Unauthorized" as const,
      status: 401 as const,
      message: "You've been signed out. Refresh the page and sign in again.",
    };

  const access = await checkFeatureAccess(userId);
  if (!access.allowed) {
    return {
      error: "Upgrade required" as const,
      status: 402 as const,
      message: "AI Email Chat is available on Pro and Max plans.",
      tier: access.tier,
    };
  }

  const userTokens = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { is_gmail: true },
  });
  if (!userTokens)
    return {
      error: "User not found" as const,
      status: 404 as const,
      message:
        "We couldn't find a connected mailbox for your account. Finish connecting Gmail or Outlook, then try again.",
    };

  return { userId, isGmail: userTokens.is_gmail };
}

const app = new Hono()

  // POST /api/chat — send a query to the AI agent
  .post("/", zValidator("json", querySchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      return ctx.json(
        {
          error: gate.error,
          message: gate.message,
          tier: "tier" in gate ? gate.tier : undefined,
        },
        gate.status,
      );
    }

    const { query, sessionId } = ctx.req.valid("json");

    const resolved = await resolveChatSession(gate.userId, sessionId);
    if (!resolved) return ctx.json(SESSION_GONE, 404);

    try {
      await saveUserMessage(resolved.sessionId, query);
      // don't block the reply on title generation
      const titlePromise = resolved.createdSession
        ? generateAndSaveTitle(resolved.sessionId, query)
        : null;

      const result = await runAgent(
        query,
        gate.userId,
        gate.isGmail,
        "api",
        undefined,
        resolved.sessionId,
      );

      // reply already generated, don't fail the request over a DB write
      try {
        await saveAssistantMessage(resolved.sessionId, result.response);
      } catch (persistError) {
        console.error(
          `[chat/api] failed to persist assistant reply (session ${resolved.sessionId}):`,
          persistError,
        );
      }
      if (titlePromise) await titlePromise;

      return ctx.json(
        {
          ...result,
          sessionId: resolved.sessionId,
          createdSession: resolved.createdSession,
        },
        200,
      );
    } catch (error) {
      console.error(
        `[chat/api] ${gate.isGmail ? "gmail" : "outlook"} error:`,
        error,
      );
      return ctx.json(
        {
          error: "Chat processing failed",
          message: friendlyError(error, gate.isGmail ? "gmail" : "outlook").message,
          sessionId: resolved.sessionId, // so a retry lands on the same thread
        },
        500,
      );
    }
  })

  // POST /api/chat/stream — same as POST /, but streams live progress over SSE.
  // Events: `status` (each agent step) → `done` (full AgentResult) | `error`.
  .post("/stream", zValidator("json", querySchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      // Auth/tier/rate errors happen before we open the stream — plain JSON.
      return ctx.json(
        {
          error: gate.error,
          message: gate.message,
          tier: "tier" in gate ? gate.tier : undefined,
        },
        gate.status,
      );
    }

    const { query, sessionId } = ctx.req.valid("json");

    // do this before streamSSE opens, otherwise a bad sessionId turns into a
    // half-open stream instead of a plain 404
    const resolved = await resolveChatSession(gate.userId, sessionId);
    if (!resolved) return ctx.json(SESSION_GONE, 404);
    await saveUserMessage(resolved.sessionId, query);

    const titlePromise = resolved.createdSession
      ? generateAndSaveTitle(resolved.sessionId, query)
      : null;

    // Defeat proxy/CDN buffering so events arrive as they're written.
    ctx.header("Cache-Control", "no-cache, no-transform");
    ctx.header("Connection", "keep-alive");
    ctx.header("X-Accel-Buffering", "no");

    return streamSSE(ctx, async (stream) => {
      // Serialize writes: runAgent's onEvent is sync, writeSSE is async, and
      // interleaved frames would corrupt the stream. Chain every write.
      let chain: Promise<unknown> = Promise.resolve();
      const enqueue = (event: string, data: unknown) => {
        chain = chain.then(() =>
          stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {}),
        );
        return chain;
      };

      // keep proxies (Cloudflare drops idle streams at ~100s) from cutting a
      // long step; the client ignores unknown events
      const ping = setInterval(() => enqueue("ping", {}), 15_000);

      // send this first so the client has the session id even if the run below errors
      await enqueue("session", {
        sessionId: resolved.sessionId,
        createdSession: resolved.createdSession,
      });

      try {
        const result = await runAgent(
          query,
          gate.userId,
          gate.isGmail,
          "api",
          (e) => enqueue("status", e),
          resolved.sessionId,
        );

        // same deal as the non-streaming route above, a DB hiccup shouldn't
        // show up as an error in the stream
        try {
          await saveAssistantMessage(resolved.sessionId, result.response);
        } catch (persistError) {
          console.error(
            `[chat/stream] failed to persist assistant reply (session ${resolved.sessionId}):`,
            persistError,
          );
        }
        if (titlePromise) await titlePromise;
        await enqueue("done", result);
      } catch (error) {
        console.error(
          `[chat/stream] ${gate.isGmail ? "gmail" : "outlook"} error:`,
          error,
        );
        await enqueue("error", {
          message: friendlyError(error, gate.isGmail ? "gmail" : "outlook").message,
        });
      } finally {
        clearInterval(ping);
      }
      // Flush anything still queued before the callback resolves (closes stream).
      await chain;
    });
  })

  // POST /api/chat/confirm — run a previously-staged destructive action
  .post("/confirm", zValidator("json", confirmSchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      return ctx.json({ error: gate.error, message: gate.message }, gate.status);
    }

    const { actionId } = ctx.req.valid("json");
    try {
      const result = await executeConfirmedAction(
        gate.userId,
        gate.isGmail,
        actionId,
      );
      // ok:false is a normal outcome the card renders, not a request failure
      return ctx.json(result, 200);
    } catch (error) {
      console.error("[chat/confirm] error:", error);
      return ctx.json(
        {
          ok: false,
          message: friendlyError(error, gate.isGmail ? "gmail" : "outlook").message,
        },
        200,
      );
    }
  })

  // GET /api/chat/sessions — the sidebar list, newest activity first
  .get("/sessions", zValidator("query", listSessionsSchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      return ctx.json({ error: gate.error, message: gate.message }, gate.status);
    }

    const { limit, cursor } = ctx.req.valid("query");

    // grab one extra row so we know if there's a next page
    const rows = await db.chatSession.findMany({
      where: { user_id: gate.userId },
      orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = rows.length > limit;
    const sessions = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sessions[sessions.length - 1].id : null;

    const decrypted = await Promise.all(
      sessions.map(async (s) => ({
        ...s,
        title: s.title ? await decrypt(s.title) : s.title,
      })),
    );

    return ctx.json({ sessions: decrypted, nextCursor }, 200);
  })

  // GET /api/chat/sessions/:sessionId/messages — one page of a thread
  .get(
    "/sessions/:sessionId/messages",
    zValidator("query", listMessagesSchema),
    async (ctx) => {
      const gate = await requireChatAccess();
      if ("error" in gate) {
        return ctx.json({ error: gate.error, message: gate.message }, gate.status);
      }

      const { sessionId } = ctx.req.param();
      const { limit, cursor } = ctx.req.valid("query");

      // don't let people read each other's sessions
      const session = await db.chatSession.findFirst({
        where: { id: sessionId, user_id: gate.userId },
        select: { id: true },
      });
      if (!session) {
        return ctx.json({ error: "Session not found" }, 404);
      }

      // query newest-first so the first page is always the tail end of the
      // conversation; cursor walks backwards from there into older messages
      const rows = await db.chatMessage.findMany({
        where: { session_id: sessionId },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          is_user: true,
          content: true,
          created_at: true,
        },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1].id : null;

      // flip back to oldest-first for rendering
      const ordered = page.slice().reverse();

      const decrypted = await Promise.all(
        ordered.map(async (m) => ({ ...m, content: await decrypt(m.content) })),
      );

      return ctx.json({ messages: decrypted, nextCursor }, 200);
    },
  )

  // GET /api/chat/attachment/:key — download a stored attachment
  .get("/attachment/:key", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const { key } = ctx.req.param();
    // not consumed on read: the model often links the same file twice, and the
    // store already expires entries after an hour
    const attachment = getAttachment(key);

    if (!attachment) {
      return ctx.json(
        { error: "This download link expired. Ask me for the file again." },
        404,
      );
    }

    const blob = new Blob([new Uint8Array(attachment.data)], {
      type: attachment.mimeType,
    });
    return new Response(blob, {
      headers: {
        // header values must be latin-1; non-ASCII names go in filename*
        "Content-Disposition": `attachment; filename="${attachment.filename.replace(/[^\x20-\x7E]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "Content-Length": blob.size.toString(),
      },
    });
  });

export default app;
