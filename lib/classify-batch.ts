import { redis } from "@/lib/redis";
import { throttled } from "@/lib/throttle";
import { classifyQueue } from "@/lib/queue";
import axios from "axios";
import type { ModelRequest, ModelResponse } from "@/lib/model";

const QUEUE_KEY = "classify:queue";
const RESULT_PREFIX = "classify:result:";
const FLUSH_LOCK_KEY = "classify:flush-lock";
const BATCH_SIZE = 5;
const RESULT_TTL = 120;

interface QueuedRequest {
  id: string;
  r: ModelRequest;
}

const apiClient = axios.create({
  baseURL: process.env.CLASSIFICATION_API_URL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.AUTHORIZATION_KEY,
  },
});

export async function bufferClassifyJob(
  requestId: string,
  request: ModelRequest,
): Promise<void> {
  const item: QueuedRequest = { id: requestId, r: request };
  const count = await redis.rpush(QUEUE_KEY, JSON.stringify(item));

  if (count >= BATCH_SIZE) {
    await classifyQueue.add("flush-classify", {}, {
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}

export async function flushClassifyBatch(): Promise<number> {
  const acquired = await redis.set(FLUSH_LOCK_KEY, "1", "EX", 120, "NX");
  if (acquired !== "OK") return 0;

  try {
    const rawItems = await redis.lrange(QUEUE_KEY, 0, BATCH_SIZE - 1);
    if (rawItems.length === 0) return 0;

    const items: QueuedRequest[] = rawItems.map((r) => JSON.parse(r));

    try {
      const response = await throttled("openai", () =>
        apiClient.post("/classify-batch", {
          requests: items.map((item) => ({
            id: item.id,
            ...item.r,
          })),
        }),
      );

      const results: {
        id: string;
        category: string;
        response_required: boolean;
        ai_summary?: string;
        ai_action?: string;
      }[] = response.data.results;

      for (const result of results) {
        const modelResponse: ModelResponse = {
          category: result.category,
          response_required: result.response_required,
          ai_summary: result.ai_summary,
          ai_action: result.ai_action,
        };
        await redis.setex(
          `${RESULT_PREFIX}${result.id}`,
          RESULT_TTL,
          JSON.stringify(modelResponse),
        );
      }
    } catch (error) {
      console.error("Batch classification failed:", error);
      for (const item of items) {
        const errorResult: ModelResponse & { _error: string } = {
          category: "",
          response_required: false,
          _error: "Classification batch failed",
        };
        await redis.setex(
          `${RESULT_PREFIX}${item.id}`,
          RESULT_TTL,
          JSON.stringify(errorResult),
        );
      }
    }

    await redis.ltrim(QUEUE_KEY, items.length, -1);
    return items.length;
  } finally {
    await redis.del(FLUSH_LOCK_KEY).catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollForResult(
  requestId: string,
  timeoutMs: number = 600_000,
): Promise<ModelResponse> {
  const startedAt = Date.now();
  const key = `${RESULT_PREFIX}${requestId}`;

  while (true) {
    const raw = await redis.get(key);
    if (raw) {
      await redis.del(key);
      const parsed = JSON.parse(raw) as ModelResponse & { _error?: string };
      if (parsed._error) {
        throw new Error(parsed._error);
      }
      return parsed;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Classification timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }

    await sleep(100);
  }
}
