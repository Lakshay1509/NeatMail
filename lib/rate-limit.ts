import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';


const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});


export const gmailWebhookLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'), 
  analytics: true,
  prefix: 'ratelimit:gmail-webhook',
});


export const apiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, '1 m'), 
  analytics: true,
  prefix: 'ratelimit:api',
});


export const routeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '10 s'), 
  analytics: true,
  prefix: 'ratelimit:route',
});

export function getIdentifier(req: Request): string {
 
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  
  const ip = cfConnectingIp || realIp || forwarded?.split(',')[0] || 'unknown';
  
  return ip;
}