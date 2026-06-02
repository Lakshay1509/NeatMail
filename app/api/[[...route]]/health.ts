import { Hono } from "hono";
import { db } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import {
  outlookMailQueue,
  outlookMailUpdateQueue,
  draftQueue,
  telegramQueue,
  dbBatchQueue,
  classifyQueue,
} from "@/lib/queue";

type CheckStatus = "ok" | "error";
type OverallStatus = "healthy" | "degraded" | "unhealthy";

interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

interface HealthResponse {
  status: OverallStatus;
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    queues: Record<string, QueueStats | { status: CheckStatus; error: string }>;
    memory: {
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
      externalMB: number;
    };
  };
}

const QUEUES = {
  "outlook-mail": outlookMailQueue,
  "outlook-mail-update": outlookMailUpdateQueue,
  draft: draftQueue,
  telegram: telegramQueue,
  "db-batch": dbBatchQueue,
  classify: classifyQueue,
} as const;

async function checkDatabase(): Promise<CheckResult> {
  const start = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const latencyMs = Math.round(performance.now() - start);
    return { status: "ok", latencyMs };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      status: "error",
      latencyMs,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = performance.now();
  try {
    const result = await redis.ping();
    const latencyMs = Math.round(performance.now() - start);
    if (result === "PONG") {
      return { status: "ok", latencyMs };
    }
    return {
      status: "error",
      latencyMs,
      error: `Unexpected ping response: ${result}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      status: "error",
      latencyMs,
      error: error instanceof Error ? error.message : "Unknown Redis error",
    };
  }
}

async function checkQueues(): Promise<
  Record<string, QueueStats | { status: CheckStatus; error: string }>
> {
  const results: Record<
    string,
    QueueStats | { status: CheckStatus; error: string }
  > = {};

  for (const [name, queue] of Object.entries(QUEUES)) {
    try {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed"
      );
      results[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      };
    } catch (error) {
      results[name] = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown queue error",
      };
    }
  }

  return results;
}

function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
  };
}

function computeOverallStatus(
  checks: HealthResponse["checks"]
): OverallStatus {
  const critical = [checks.database, checks.redis];
  const criticalFailed = critical.filter((c) => c.status === "error").length;

  if (criticalFailed >= critical.length) return "unhealthy";
  if (criticalFailed > 0) return "degraded";

  for (const entry of Object.values(checks.queues)) {
    if ("status" in entry && entry.status === "error") return "degraded";
  }

  return "healthy";
}

function buildHealthResponse(
  database: CheckResult,
  redisCheck: CheckResult,
  queues: Record<string, QueueStats | { status: CheckStatus; error: string }>,
  memory: HealthResponse["checks"]["memory"]
): HealthResponse {
  const checks = { database, redis: redisCheck, queues, memory };
  const status = computeOverallStatus(checks);
  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    version: process.version,
    checks,
  };
}

const app = new Hono();

app.get("/", async (c) => {
  const [database, redisCheck, queues] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkQueues(),
  ]);
  const memory = getMemoryStats();
  const response = buildHealthResponse(database, redisCheck, queues, memory);
  const statusCode =
    response.status === "healthy"
      ? 200
      : response.status === "degraded"
        ? 200
        : 503;
  return c.json(response, statusCode);
});

app.get("/live", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  });
});

app.get("/ready", async (c) => {
  const [database, redisCheck] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);
  const allOk = database.status === "ok" && redisCheck.status === "ok";
  return c.json(
    {
      status: allOk ? "ready" : "not ready",
      timestamp: new Date().toISOString(),
      checks: { database, redis: redisCheck },
    },
    allOk ? 200 : 503
  );
});

export default app;
