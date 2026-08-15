/**
 * In-memory ioredis stand-in.
 *
 * Deliberately a real implementation rather than a stub: lib/rate-limit.ts's sliding
 * window is sorted-set arithmetic, and stubbing it out would leave the only interesting
 * part of that module untested. Supports the string / hash / sorted-set commands this
 * codebase actually issues, plus `multi()` pipelines.
 *
 * `eval` cannot run Lua, so scripts are dispatched to handlers registered with
 * `registerLuaScript` (matched on a substring of the script body). Unregistered scripts
 * throw loudly instead of silently returning null.
 */

type Entry =
  | { type: "string"; value: string; expiresAt: number | null }
  | { type: "hash"; value: Map<string, string>; expiresAt: number | null }
  | { type: "zset"; value: Map<string, number>; expiresAt: number | null };

type LuaHandler = (
  store: FakeRedis,
  keys: string[],
  argv: string[],
) => unknown | Promise<unknown>;

const luaHandlers: { match: string; handler: LuaHandler }[] = [];

/** Registers a JS stand-in for a Lua script, matched when `match` appears in the body. */
export function registerLuaScript(match: string, handler: LuaHandler): void {
  luaHandlers.push({ match, handler });
}

export function clearLuaScripts(): void {
  luaHandlers.length = 0;
}

export class FakeRedis {
  store = new Map<string, Entry>();
  /** Every command issued, in order — for asserting on call patterns. */
  calls: { cmd: string; args: unknown[] }[] = [];

  constructor(..._args: unknown[]) {
    // Registers on construction so `resetRedis()` reaches clients that lib modules
    // build at import time (lib/redis.ts, lib/rate-limit.ts) without those modules
    // having to go through a factory.
    redisInstances.push(this);
  }

  private record(cmd: string, args: unknown[]) {
    this.calls.push({ cmd, args });
  }

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private zset(key: string): Map<string, number> {
    const entry = this.live(key);
    if (entry?.type === "zset") return entry.value;
    const value = new Map<string, number>();
    this.store.set(key, { type: "zset", value, expiresAt: null });
    return value;
  }

  private hash(key: string): Map<string, string> {
    const entry = this.live(key);
    if (entry?.type === "hash") return entry.value;
    const value = new Map<string, string>();
    this.store.set(key, { type: "hash", value, expiresAt: null });
    return value;
  }

  // ── strings ────────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.record("get", [key]);
    const entry = this.live(key);
    return entry?.type === "string" ? entry.value : null;
  }

  /** Supports `set(k, v)`, `set(k, v, 'EX', n)`, `set(k, v, 'PX', n)` and a trailing `NX`/`XX`. */
  async set(key: string, value: string, ...opts: unknown[]): Promise<"OK" | null> {
    this.record("set", [key, value, ...opts]);
    const flags = opts.map((o) => String(o).toUpperCase());
    const exists = this.live(key) !== undefined;
    if (flags.includes("NX") && exists) return null;
    if (flags.includes("XX") && !exists) return null;

    let expiresAt: number | null = null;
    const ex = flags.indexOf("EX");
    const px = flags.indexOf("PX");
    if (ex !== -1) expiresAt = Date.now() + Number(opts[ex + 1]) * 1000;
    else if (px !== -1) expiresAt = Date.now() + Number(opts[px + 1]);

    this.store.set(key, { type: "string", value: String(value), expiresAt });
    return "OK";
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.record("setex", [key, seconds, value]);
    this.store.set(key, {
      type: "string",
      value: String(value),
      expiresAt: Date.now() + seconds * 1000,
    });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.record("del", keys);
    let removed = 0;
    for (const key of keys.flat()) {
      if (this.store.delete(key)) removed++;
    }
    return removed;
  }

  async exists(...keys: string[]): Promise<number> {
    this.record("exists", keys);
    return keys.flat().filter((k) => this.live(k) !== undefined).length;
  }

  async incr(key: string): Promise<number> {
    this.record("incr", [key]);
    const entry = this.live(key);
    const next = (entry?.type === "string" ? Number(entry.value) : 0) + 1;
    this.store.set(key, {
      type: "string",
      value: String(next),
      expiresAt: entry?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.record("expire", [key, seconds]);
    return this.pexpire(key, seconds * 1000);
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.record("pexpire", [key, ms]);
    const entry = this.live(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + ms;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.record("ttl", [key]);
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  // ── hashes ─────────────────────────────────────────────────────────────────

  async hget(key: string, field: string): Promise<string | null> {
    this.record("hget", [key, field]);
    return this.hash(key).get(field) ?? null;
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    this.record("hmget", [key, ...fields]);
    const h = this.hash(key);
    return fields.flat().map((f) => h.get(f) ?? null);
  }

  async hset(key: string, ...pairs: unknown[]): Promise<number> {
    this.record("hset", [key, ...pairs]);
    const h = this.hash(key);
    for (let i = 0; i < pairs.length; i += 2) {
      h.set(String(pairs[i]), String(pairs[i + 1]));
    }
    return 1;
  }

  async hmset(key: string, ...pairs: unknown[]): Promise<"OK"> {
    await this.hset(key, ...pairs);
    return "OK";
  }

  // ── sorted sets ────────────────────────────────────────────────────────────

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.record("zadd", [key, score, member]);
    const z = this.zset(key);
    const isNew = !z.has(member);
    z.set(member, Number(score));
    return isNew ? 1 : 0;
  }

  async zcard(key: string): Promise<number> {
    this.record("zcard", [key]);
    return this.zset(key).size;
  }

  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    this.record("zremrangebyscore", [key, min, max]);
    const z = this.zset(key);
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of z) {
      if (score >= lo && score <= hi) {
        z.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    this.record("zrange", [key, start, stop]);
    const sorted = [...this.zset(key).entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);
    const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    return sorted.slice(start, end);
  }

  // ── scripting / misc ───────────────────────────────────────────────────────

  async eval(
    script: string,
    numKeys: number,
    ...rest: unknown[]
  ): Promise<unknown> {
    this.record("eval", [script, numKeys, ...rest]);
    const keys = rest.slice(0, numKeys).map(String);
    const argv = rest.slice(numKeys).map(String);
    const entry = luaHandlers.find((h) => script.includes(h.match));
    if (!entry) {
      throw new Error(
        `FakeRedis.eval: no handler registered for this Lua script. ` +
          `Register one with registerLuaScript(<substring>, handler).`,
      );
    }
    return entry.handler(this, keys, argv);
  }

  async ping(): Promise<string> {
    this.record("ping", []);
    return "PONG";
  }

  multi(): FakePipeline {
    this.record("multi", []);
    return new FakePipeline(this);
  }

  pipeline(): FakePipeline {
    return this.multi();
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }
  disconnect(): void {}
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  off(): this {
    return this;
  }

  /** Wipes keys and recorded calls between tests. */
  reset(): void {
    this.store.clear();
    this.calls = [];
  }
}

/** Queues commands and resolves them in order, mirroring ioredis' `[err, result]` tuples. */
class FakePipeline {
  private ops: (() => Promise<unknown>)[] = [];

  constructor(private redis: FakeRedis) {}

  private queue(fn: () => Promise<unknown>): this {
    this.ops.push(fn);
    return this;
  }

  zremrangebyscore(key: string, min: number, max: number) {
    return this.queue(() => this.redis.zremrangebyscore(key, min, max));
  }
  zadd(key: string, score: number, member: string) {
    return this.queue(() => this.redis.zadd(key, score, member));
  }
  zcard(key: string) {
    return this.queue(() => this.redis.zcard(key));
  }
  pexpire(key: string, ms: number) {
    return this.queue(() => this.redis.pexpire(key, ms));
  }
  expire(key: string, s: number) {
    return this.queue(() => this.redis.expire(key, s));
  }
  incr(key: string) {
    return this.queue(() => this.redis.incr(key));
  }
  set(key: string, value: string, ...opts: unknown[]) {
    return this.queue(() => this.redis.set(key, value, ...opts));
  }
  get(key: string) {
    return this.queue(() => this.redis.get(key));
  }
  del(...keys: string[]) {
    return this.queue(() => this.redis.del(...keys));
  }

  async exec(): Promise<[Error | null, unknown][]> {
    const results: [Error | null, unknown][] = [];
    for (const op of this.ops) {
      try {
        results.push([null, await op()]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }
    return results;
  }
}

/**
 * Every FakeRedis built during the test run. lib/rate-limit.ts and lib/redis.ts each
 * construct their own client at import time, so `resetRedis()` has to reach all of them.
 */
export const redisInstances: FakeRedis[] = [];

export function resetRedis(): void {
  for (const instance of redisInstances) instance.reset();
}
