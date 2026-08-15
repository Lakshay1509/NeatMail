import { describe, expect, it } from "bun:test";

import {
  apiLimiter,
  bullboardAuthLimiter,
  getIdentifier,
  gmailUserBurstLimiter,
  gmailWebhookLimiter,
} from "@/lib/rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://test.neatmail.app/api/email", { headers });
}

describe("getIdentifier", () => {
  it("keys on the user id whenever someone is signed in", () => {
    expect(getIdentifier(request({ "cf-connecting-ip": "1.2.3.4" }), "user_1")).toBe(
      "user:user_1",
    );
  });

  it("falls back to the IP for anonymous requests", () => {
    expect(getIdentifier(request({ "cf-connecting-ip": "1.2.3.4" }))).toBe(
      "ip:1.2.3.4",
    );
    expect(getIdentifier(request({ "cf-connecting-ip": "1.2.3.4" }), null)).toBe(
      "ip:1.2.3.4",
    );
  });

  it("prefers cf-connecting-ip, then x-real-ip, then x-forwarded-for", () => {
    // Cloudflare sits in front, so its header is the one that cannot be spoofed
    // by a client appending to x-forwarded-for.
    const all = request({
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3",
    });
    expect(getIdentifier(all)).toBe("ip:1.1.1.1");

    expect(
      getIdentifier(request({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" })),
    ).toBe("ip:2.2.2.2");

    expect(getIdentifier(request({ "x-forwarded-for": "3.3.3.3" }))).toBe(
      "ip:3.3.3.3",
    );
  });

  it("takes the client IP — the first hop — out of an x-forwarded-for chain", () => {
    expect(
      getIdentifier(request({ "x-forwarded-for": "3.3.3.3, 10.0.0.1, 10.0.0.2" })),
    ).toBe("ip:3.3.3.3");
  });

  it("falls back to a shared 'unknown' bucket when no IP header is present", () => {
    expect(getIdentifier(request())).toBe("ip:unknown");
  });
});

describe("sliding window", () => {
  it("allows requests up to the limit and rejects the one past it", async () => {
    const id = `test-${crypto.randomUUID()}`;

    for (let i = 1; i <= 5; i++) {
      const result = await bullboardAuthLimiter.limit(id);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(5 - i);
    }

    const blocked = await bullboardAuthLimiter.limit(id);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keeps separate budgets per identifier", async () => {
    const a = `a-${crypto.randomUUID()}`;
    const b = `b-${crypto.randomUUID()}`;

    for (let i = 0; i < 5; i++) await bullboardAuthLimiter.limit(a);

    expect((await bullboardAuthLimiter.limit(a)).success).toBe(false);
    expect((await bullboardAuthLimiter.limit(b)).success).toBe(true);
  });

  it("keeps separate budgets per limiter, even for the same identifier", async () => {
    // Distinct key prefixes: exhausting the auth limiter must not lock the API.
    const id = `shared-${crypto.randomUUID()}`;

    for (let i = 0; i < 6; i++) await bullboardAuthLimiter.limit(id);

    expect((await bullboardAuthLimiter.limit(id)).success).toBe(false);
    expect((await apiLimiter.limit(id)).success).toBe(true);
  });

  it("reports the configured limit and a reset one window out", async () => {
    const before = Date.now();
    const result = await apiLimiter.limit(`reset-${crypto.randomUUID()}`);

    expect(result.limit).toBe(300);
    // '1 m' must parse to 60_000ms, not the 60ms a naive parse would produce.
    expect(result.reset - before).toBeGreaterThanOrEqual(60_000);
    expect(result.reset - before).toBeLessThan(61_000);
  });

  it("never reports negative headroom once over the limit", async () => {
    const id = `neg-${crypto.randomUUID()}`;
    for (let i = 0; i < 8; i++) await bullboardAuthLimiter.limit(id);

    const result = await bullboardAuthLimiter.limit(id);
    expect(result.remaining).toBe(0);
  });
});

describe("limiter configuration", () => {
  it("gives webhooks and the API a 300/min budget", async () => {
    expect((await gmailWebhookLimiter.limit(crypto.randomUUID())).limit).toBe(300);
    expect((await apiLimiter.limit(crypto.randomUUID())).limit).toBe(300);
  });

  it("caps a single mailbox's worker burst well below the queue-wide budget", async () => {
    // One flooded mailbox must not be able to occupy the shared worker concurrency.
    const burst = await gmailUserBurstLimiter.limit(crypto.randomUUID());
    expect(burst.limit).toBe(30);
    expect(burst.limit).toBeLessThan(300);
  });

  it("keeps the Bull Board auth limiter tight enough to stop password guessing", async () => {
    expect((await bullboardAuthLimiter.limit(crypto.randomUUID())).limit).toBe(5);
  });
});
