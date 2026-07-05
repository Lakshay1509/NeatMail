import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { auth } from "@clerk/nextjs/server";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { checkFeatureAccess } from "@/lib/tier-guard";
import { runAgent, executeConfirmedAction } from "@/lib/agent/orchestrator";
import { consumeAttachment } from "@/lib/chat/attachment-store";

const querySchema = z.object({
  query: z.string().min(1).max(2000),
});

const confirmSchema = z.object({
  actionId: z.string().min(1),
});

async function requireChatAccess() {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" as const, status: 401 as const };

  const access = await checkFeatureAccess(userId);
  if (!access.allowed) {
    return {
      error: "Upgrade required" as const,
      status: 402 as const,
      tier: access.tier,
    };
  }

  const userTokens = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { is_gmail: true },
  });
  if (!userTokens) return { error: "User not found" as const, status: 404 as const };

  return { userId, isGmail: userTokens.is_gmail };
}

const app = new Hono()

  // POST /api/chat — send a query to the AI agent
  .post("/", zValidator("json", querySchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      return ctx.json(
        gate.status === 402
          ? {
              error: gate.error,
              message: "AI Email Chat is available on Pro and Max plans.",
              tier: gate.tier,
            }
          : { error: gate.error },
        gate.status,
      );
    }

    const { query } = ctx.req.valid("json");

    try {
      const result = await runAgent(query, gate.userId, gate.isGmail, "api");
      return ctx.json(result, 200);
    } catch (error) {
      console.error(
        `[chat/api] ${gate.isGmail ? "gmail" : "outlook"} error:`,
        error,
      );
      return ctx.json(
        {
          error: "Chat processing failed",
          message:
            error instanceof Error ? error.message : "Internal server error",
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
        gate.status === 402
          ? {
              error: gate.error,
              message: "AI Email Chat is available on Pro and Max plans.",
              tier: gate.tier,
            }
          : { error: gate.error },
        gate.status,
      );
    }

    const { query } = ctx.req.valid("json");

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

      try {
        const result = await runAgent(
          query,
          gate.userId,
          gate.isGmail,
          "api",
          (e) => enqueue("status", e),
        );
        await enqueue("done", result);
      } catch (error) {
        console.error(
          `[chat/stream] ${gate.isGmail ? "gmail" : "outlook"} error:`,
          error,
        );
        await enqueue("error", {
          message:
            error instanceof Error ? error.message : "Chat processing failed",
        });
      }
      // Flush anything still queued before the callback resolves (closes stream).
      await chain;
    });
  })

  // POST /api/chat/confirm — run a previously-staged destructive action
  .post("/confirm", zValidator("json", confirmSchema), async (ctx) => {
    const gate = await requireChatAccess();
    if ("error" in gate) {
      return ctx.json({ error: gate.error }, gate.status);
    }

    const { actionId } = ctx.req.valid("json");
    try {
      const result = await executeConfirmedAction(
        gate.userId,
        gate.isGmail,
        actionId,
      );
      return ctx.json(result, result.ok ? 200 : 400);
    } catch (error) {
      console.error("[chat/confirm] error:", error);
      return ctx.json(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : "Confirmation failed",
        },
        500,
      );
    }
  })

  // GET /api/chat/attachment/:key — download a stored attachment
  .get("/attachment/:key", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unauthorized" }, 401);
    }

    const { key } = ctx.req.param();
    const attachment = consumeAttachment(key);

    if (!attachment) {
      return ctx.json({ error: "Attachment not found or expired" }, 404);
    }

    const blob = new Blob([new Uint8Array(attachment.data)], {
      type: attachment.mimeType,
    });
    return new Response(blob, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachment.filename}"`,
        "Content-Length": blob.size.toString(),
      },
    });
  });

export default app;
