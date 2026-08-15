import { afterEach, describe, expect, it, spyOn } from "bun:test";

import health from "@/app/api/[[...route]]/health";
import { redis } from "@/lib/redis";
import { mountRouter } from "../helpers/api";
import { db } from "../helpers/prisma-mock";
import { queues } from "../helpers/queue-mock";

const api = mountRouter("/health", health);

const spies: { mockRestore: () => void }[] = [];

function breakRedis(error = new Error("redis connection refused")) {
  const spy = spyOn(redis, "ping").mockRejectedValue(error);
  spies.push(spy);
}

function breakDatabase(error = new Error("connection terminated")) {
  db.$queryRaw.mockRejectedValue(error);
}

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("GET /api/health", () => {
  it("reports healthy with both dependencies up", async () => {
    const res = await api.get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.checks.database.status).toBe("ok");
    expect(res.body.checks.redis.status).toBe("ok");
  });

  it("includes memory, uptime and version for the ops dashboard", async () => {
    const res = await api.get("/health");

    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.version).toBe(process.version);
    expect(res.body.checks.memory.heapUsedMB).toBeGreaterThan(0);
    expect(res.body.checks.memory.rssMB).toBeGreaterThan(0);
    expect(Date.parse(res.body.timestamp)).not.toBeNaN();
  });

  it("reports job counts for every queue", async () => {
    const res = await api.get("/health");

    for (const name of [
      "outlook-mail",
      "outlook-mail-update",
      "gmail-mail",
      "gmail-sent-mail",
      "draft",
      "telegram",
      "db-batch",
      "classify",
    ]) {
      expect(res.body.checks.queues[name]).toEqual({
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 0,
      });
    }
  });

  it("degrades — but stays 200 — when only Redis is down", async () => {
    breakRedis();

    const res = await api.get("/health");

    // Still 200: a degraded instance is serving traffic and must not be pulled
    // from the load balancer.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.redis.status).toBe("error");
    expect(res.body.checks.redis.error).toContain("redis connection refused");
    expect(res.body.checks.database.status).toBe("ok");
  });

  it("degrades when only the database is down", async () => {
    breakDatabase();

    const res = await api.get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.database.status).toBe("error");
  });

  it("returns 503 unhealthy when both critical dependencies are down", async () => {
    breakRedis();
    breakDatabase();

    const res = await api.get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
  });

  it("degrades on a queue failure without failing the whole check", async () => {
    queues.gmailMailQueue.getJobCounts.mockRejectedValue(new Error("queue timeout"));

    const res = await api.get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.queues["gmail-mail"]).toEqual({
      status: "error",
      error: "queue timeout",
    });
    // The other queues still report normally.
    expect(res.body.checks.queues.draft.waiting).toBe(0);
  });

  it("surfaces real backlog numbers", async () => {
    queues.classifyQueue.getJobCounts.mockResolvedValue({
      waiting: 120,
      active: 4,
      delayed: 2,
      completed: 9001,
      failed: 7,
    });

    const res = await api.get("/health");

    expect(res.body.checks.queues.classify).toEqual({
      waiting: 120,
      active: 4,
      delayed: 2,
      completed: 9001,
      failed: 7,
    });
  });

  it("defaults a missing count to zero rather than undefined", async () => {
    queues.draftQueue.getJobCounts.mockResolvedValue({ waiting: 3 });

    const res = await api.get("/health");

    expect(res.body.checks.queues.draft).toEqual({
      waiting: 3,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    });
  });

  it("reports a non-Error rejection as an unknown error rather than crashing", async () => {
    const spy = spyOn(redis, "ping").mockRejectedValue("boom");
    spies.push(spy);

    const res = await api.get("/health");

    expect(res.body.checks.redis.error).toBe("Unknown Redis error");
  });

  it("flags an unexpected ping response as an error", async () => {
    const spy = spyOn(redis, "ping").mockResolvedValue("WAT");
    spies.push(spy);

    const res = await api.get("/health");

    expect(res.body.checks.redis.status).toBe("error");
    expect(res.body.checks.redis.error).toContain("WAT");
  });
});

describe("GET /api/health/live", () => {
  it("answers 200 without touching any dependency", async () => {
    breakRedis();
    breakDatabase();

    const res = await api.get("/health/live");

    // Liveness means "the process is running" — a dead database must not get the
    // container restarted in a loop.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("GET /api/health/ready", () => {
  it("is ready when both dependencies answer", async () => {
    const res = await api.get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("is 503 not ready when Redis is down", async () => {
    breakRedis();

    const res = await api.get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not ready");
  });

  it("is 503 not ready when the database is down", async () => {
    breakDatabase();

    const res = await api.get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.checks.database.status).toBe("error");
  });

  it("ignores queue health — readiness is about serving requests", async () => {
    queues.gmailMailQueue.getJobCounts.mockRejectedValue(new Error("queue down"));

    const res = await api.get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });
});
