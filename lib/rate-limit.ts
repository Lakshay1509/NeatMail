import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

class CustomRateLimit {
  private redis: Redis;
  private limitCount: number;
  private windowDurationMs: number;
  private prefix: string;

  constructor(options: { redis: Redis; limit: number; window: string; prefix: string }) {
    this.redis = options.redis;
    this.limitCount = options.limit;
    
    // Parse duration strings like '1 m', '10 s'
    const [amount, unit] = options.window.split(' ');
    const amt = parseInt(amount, 10);
    if (unit.startsWith('s')) this.windowDurationMs = amt * 1000;
    else if (unit.startsWith('m')) this.windowDurationMs = amt * 60 * 1000;
    else if (unit.startsWith('h')) this.windowDurationMs = amt * 60 * 60 * 1000;
    else this.windowDurationMs = 60000; // default 1 minute

    this.prefix = options.prefix;
  }

  async limit(identifier: string) {
    const key = `${this.prefix}:${identifier}`;
    const now = Date.now();
    const clearBefore = now - this.windowDurationMs;

    // Use a transaction to perform Sliding Window rate limiting via Sorted Sets
    const multi = this.redis.multi();
    multi.zremrangebyscore(key, 0, clearBefore);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.zcard(key);
    multi.pexpire(key, this.windowDurationMs);

    const results = await multi.exec();
    
    // zcard result is the 3rd operation (index 2)
    const count = results![2][1] as number;
    
    const success = count <= this.limitCount;
    const remaining = Math.max(0, this.limitCount - count);
    const reset = now + this.windowDurationMs;

    return { success, limit: this.limitCount, remaining, reset };
  }
}

export const gmailWebhookLimiter = new CustomRateLimit({
  redis,
  limit: 100,
  window: '1 m',
  prefix: 'ratelimit:gmail-webhook',
});

export const apiLimiter = new CustomRateLimit({
  redis,
  limit: 50,
  window: '1 m',
  prefix: 'ratelimit:api',
});

export const routeLimiter = new CustomRateLimit({
  redis,
  limit: 100,
  window: '1 m',
  prefix: 'ratelimit:route',
});

export function getIdentifier(req: Request, userId?: string | null): string {
  if (userId) {
    return `user:${userId}`;
  }

  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  
  const ip = cfConnectingIp || realIp || forwarded?.split(',')[0] || 'unknown';
  
  return `ip:${ip}`;
}
