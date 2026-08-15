import { beforeEach, describe, expect, it } from "bun:test";

import { ThrottleTimeoutError, throttled } from "@/lib/throttle";
import { registerLuaScript } from "../helpers/redis-mock";

/**
 * The token bucket lives in a Lua script, which the in-memory Redis cannot run. This is a
 * faithful JS port of it — same refill maths, same "return 0 or the wait in ms" contract —
 * so the control flow under test (wait, retry, give up) sees realistic answers.
 */
const buckets = new Map<string, { tokens: number; lastRefill: number }>();
const keysSeen: string[] = [];

function installBucket() {
  buckets.clear();
  keysSeen.length = 0;

  registerLuaScript("local maxTokens = tonumber(ARGV[1])", (_redis, keys, argv) => {
    const key = keys[0];
    const [maxTokens, intervalMs, now, cost] = argv.map(Number);
    keysSeen.push(key);

    const state = buckets.get(key) ?? { tokens: maxTokens, lastRefill: now };
    const elapsed = now - state.lastRefill;
    let tokens = Math.min(maxTokens, state.tokens + elapsed / intervalMs);

    if (tokens >= cost) {
      tokens -= cost;
      buckets.set(key, { tokens, lastRefill: now });
      return 0;
    }

    buckets.set(key, { tokens, lastRefill: now });
    return Math.ceil((cost - tokens) * intervalMs);
  });
}

beforeEach(installBucket);

describe("passthrough", () => {
  it("runs the function and returns its value when tokens are available", async () => {
    const result = await throttled("openai", async () => "answer", { rpm: 60 });
    expect(result).toBe("answer");
  });

  it("accepts a synchronous function too", async () => {
    expect(await throttled("openai", () => 42, { rpm: 60 })).toBe(42);
  });

  it("propagates the function's own error untouched", async () => {
    const boom = new Error("upstream 500");
    expect(
      throttled("openai", async () => {
        throw boom;
      }, { rpm: 60 }),
    ).rejects.toThrow("upstream 500");
  });

  it("does not call the function until a token is granted", async () => {
    let called = 0;
    // Bucket of 1 refilling once a minute: the second call can never be served
    // inside the timeout, so its function must never run.
    await throttled("openai", () => called++, { rpm: 1, timeoutMs: 50 });
    expect(
      throttled("openai", () => called++, { rpm: 1, timeoutMs: 50 }),
    ).rejects.toThrow(ThrottleTimeoutError);
    expect(called).toBe(1);
  });
});

describe("provider configuration", () => {
  it("uses the built-in default for a known provider", async () => {
    expect(await throttled("openai", async () => "ok")).toBe("ok");
    expect(await throttled("google", async () => "ok")).toBe("ok");
  });

  it("throws for an unknown provider with no explicit limit", async () => {
    expect(throttled("mystery-api", async () => "ok")).rejects.toThrow(
      'No default throttle config for provider "mystery-api"',
    );
  });

  it("accepts an unknown provider once given an explicit rpm or rps", async () => {
    expect(await throttled("mystery-api", async () => "ok", { rpm: 10 })).toBe("ok");
    expect(await throttled("mystery-api", async () => "ok", { rps: 5 })).toBe("ok");
  });
});

describe("bucket keys", () => {
  it("shares one global bucket per provider by default", async () => {
    await throttled("openai", async () => "ok", { rpm: 60 });
    expect(keysSeen).toEqual(["throttle:openai"]);
  });

  it("gives each user their own bucket when userId is passed", async () => {
    await throttled("google", async () => "ok", { userId: "user_1", units: 5 });
    await throttled("google", async () => "ok", { userId: "user_2", units: 5 });

    expect(keysSeen).toEqual(["throttle:google:user_1", "throttle:google:user_2"]);
  });

  it("keeps per-user budgets independent", async () => {
    // user_1 drains their bucket; user_2 must be unaffected.
    await throttled("google", async () => "ok", {
      userId: "user_1",
      rpm: 2,
      units: 2,
    });

    expect(
      throttled("google", async () => "ok", {
        userId: "user_1",
        rpm: 2,
        units: 2,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(ThrottleTimeoutError);

    expect(
      await throttled("google", async () => "ok", {
        userId: "user_2",
        rpm: 2,
        units: 2,
      }),
    ).toBe("ok");
  });
});

describe("quota units", () => {
  it("charges the requested number of units against the bucket", async () => {
    // Bucket of 10 units/sec; a 10-unit call empties it in one go.
    await throttled("gmail", async () => "ok", { rps: 10, units: 10 });

    expect(
      throttled("gmail", async () => "ok", { rps: 10, units: 10, timeoutMs: 20 }),
    ).rejects.toThrow(ThrottleTimeoutError);
  });

  it("rejects a call that could never fit, rather than waiting out the timeout", async () => {
    expect(
      throttled("gmail", async () => "ok", { rps: 5, units: 6 }),
    ).rejects.toThrow("exceeds bucket capacity");
  });

  it("defaults to one unit per call", async () => {
    for (let i = 0; i < 3; i++) {
      await throttled("gmail", async () => "ok", { rps: 3 });
    }
    expect(
      throttled("gmail", async () => "ok", { rps: 3, timeoutMs: 20 }),
    ).rejects.toThrow(ThrottleTimeoutError);
  });
});

describe("waiting and timing out", () => {
  it("waits for a refill and then proceeds", async () => {
    // 100/sec means a token refills every 10ms — a short, real wait.
    await throttled("fast-api", async () => "ok", { rps: 100, units: 100 });

    const startedAt = Date.now();
    const result = await throttled("fast-api", async () => "ok", {
      rps: 100,
      units: 1,
      timeoutMs: 2000,
    });

    expect(result).toBe("ok");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
  });

  it("throws ThrottleTimeoutError naming the provider and budget", async () => {
    await throttled("slow-api", async () => "ok", { rpm: 1 });

    let thrown: unknown;
    try {
      await throttled("slow-api", async () => "ok", { rpm: 1, timeoutMs: 100 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ThrottleTimeoutError);
    expect((thrown as ThrottleTimeoutError).provider).toBe("slow-api");
    expect((thrown as ThrottleTimeoutError).timeoutMs).toBe(100);
    expect((thrown as Error).message).toContain("slow-api");
  });

  it("gives up immediately when the wait already exceeds the budget", async () => {
    // Refill is a full minute away; the loop must not sleep on it first.
    await throttled("slow-api", async () => "ok", { rpm: 1 });

    const startedAt = Date.now();
    expect(
      throttled("slow-api", async () => "ok", { rpm: 1, timeoutMs: 200 }),
    ).rejects.toThrow(ThrottleTimeoutError);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });
});
