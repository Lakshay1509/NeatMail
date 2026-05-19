import { redis } from "./redis";

const THROTTLE_PREFIX = "throttle";

const DEFAULT_LIMITS: Record<string, { rpm?: number; rps?: number }> = {
  openai: { rpm: 500 },
  google: { rps: 250 },
};

export class ThrottleTimeoutError extends Error {
  constructor(
    public readonly provider: string,
    public readonly timeoutMs: number
  ) {
    super(
      `Throttle timeout for "${provider}": exceeded max wait time of ${timeoutMs}ms`
    );
    this.name = "ThrottleTimeoutError";
  }
}

export interface ThrottleOptions {
  /** Requests per minute limit */
  rpm?: number;
  /** Requests per second limit */
  rps?: number;
  /** Max total wait time in milliseconds (default: 30000) */
  timeoutMs?: number;
}

const THROTTLE_LUA = `
  local key = KEYS[1]
  local maxTokens = tonumber(ARGV[1])
  local intervalMs = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
  local tokens = tonumber(data[1])
  local lastRefill = tonumber(data[2])

  if tokens == nil then
    tokens = maxTokens
    lastRefill = now
  end

  local elapsed = now - lastRefill
  local newTokens = math.min(maxTokens, tokens + (elapsed / intervalMs))

  if newTokens >= 1 then
    newTokens = newTokens - 1
    redis.call('HMSET', key, 'tokens', newTokens, 'lastRefill', now)
    redis.call('PEXPIRE', key, 60000)
    return 0
  else
    local waitMs = math.ceil((1 - newTokens) * intervalMs)
    redis.call('HMSET', key, 'tokens', newTokens, 'lastRefill', now)
    redis.call('PEXPIRE', key, 60000)
    return waitMs
  end
`;

function resolveConfig(
  provider: string,
  options?: ThrottleOptions
): { maxTokens: number; intervalMs: number; timeoutMs: number } {
  const timeoutMs = options?.timeoutMs ?? 30_000;

  let maxTokens: number;
  let windowMs: number;

  if (options?.rpm !== undefined) {
    maxTokens = options.rpm;
    windowMs = 60_000;
  } else if (options?.rps !== undefined) {
    maxTokens = options.rps;
    windowMs = 1_000;
  } else {
    const defaults = DEFAULT_LIMITS[provider];
    if (!defaults) {
      throw new Error(
        `No default throttle config for provider "${provider}". Pass rpm or rps in options.`
      );
    }
    if (defaults.rpm !== undefined) {
      maxTokens = defaults.rpm;
      windowMs = 60_000;
    } else if (defaults.rps !== undefined) {
      maxTokens = defaults.rps;
      windowMs = 1_000;
    } else {
      throw new Error(
        `Invalid default throttle config for provider "${provider}".`
      );
    }
  }

  const intervalMs = windowMs / maxTokens;
  return { maxTokens, intervalMs, timeoutMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function while respecting a global rate limit backed by Redis.
 *
 * Uses a token-bucket algorithm (atomic Lua script) so it works correctly
 * across multiple server instances.
 *
 * @example
 * // Uses built-in default (openai = 500 RPM)
 * const result = await throttled('openai', () => openai.chat.completions.create({...}));
 *
 * @example
 * // Override for a specific call
 * const result = await throttled('openai', () => openai.chat.completions.create({...}), { rpm: 100 });
 *
 * @example
 * // Google at 250 RPS (built-in default)
 * const result = await throttled('google', () => gmail.users.messages.get({...}));
 */
export async function throttled<T>(
  provider: string,
  fn: () => Promise<T> | T,
  options?: ThrottleOptions
): Promise<T> {
  const { maxTokens, intervalMs, timeoutMs } = resolveConfig(
    provider,
    options
  );
  const key = `${THROTTLE_PREFIX}:${provider}`;
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const alreadyWaited = now - startedAt;

    if (alreadyWaited >= timeoutMs) {
      throw new ThrottleTimeoutError(provider, timeoutMs);
    }

    const waitMs = (await redis.eval(
      THROTTLE_LUA,
      1,
      key,
      maxTokens,
      intervalMs,
      now
    )) as number;

    if (waitMs === 0) {
      // Token granted — execute the actual work
      return await fn();
    }

    // Would the next wait push us over the timeout?
    if (alreadyWaited + waitMs > timeoutMs) {
      throw new ThrottleTimeoutError(provider, timeoutMs);
    }

    await sleep(waitMs);
  }
}
