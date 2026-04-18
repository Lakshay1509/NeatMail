import { Hono } from "hono";
import { handle } from "hono/vercel";
import { auth } from '@clerk/nextjs/server';
import { apiLimiter, gmailWebhookLimiter, getIdentifier } from '@/lib/rate-limit';

import email from './email'
import webhook from './gmail-webhook'
import watch from './activate-watch'
import clerk from './clerk'
import tags from './tags'
import user from './user'
import checkout from './checkout'
import dodowebhook from './dodo-webhook'
import cron from './cron'
import draftPreference from './draft-preference'
import outlook from './outlook'
import telegram from './telegram'
import stats from './stats'
import freeTrial from './freeTrial'



export const runtime = "nodejs";
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

const app = new Hono().basePath("/api");

// Global API rate limiting
app.use('*', async (c, next) => {
  const clerkAuth = await auth();
  const userId = clerkAuth?.userId;
  // Hono exposes standard web Request at c.req.raw
  const identifier = getIdentifier(c.req.raw, userId);

  try {
    let rateLimitResult;
    const path = c.req.path;

    if (
      path.startsWith('/api/gmail-webhook') ||
      path.startsWith('/api/clerk') ||
      path.startsWith('/api/dodowebhook') ||
      path.startsWith('/api/inngest') ||
      path.startsWith('/api/outlook') ||
      path.startsWith('/api/telegram/webhook')
    ) {
      rateLimitResult = await gmailWebhookLimiter.limit(identifier);
    } else {
      rateLimitResult = await apiLimiter.limit(identifier);
    }

    if (rateLimitResult) {
      c.header('X-RateLimit-Limit', rateLimitResult.limit.toString());
      c.header('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
      c.header('X-RateLimit-Reset', new Date(rateLimitResult.reset).toISOString());

      if (!rateLimitResult.success) {
        return c.json(
          { error: 'Too many requests', message: 'Please try again later' },
          429
        );
      }
    }
  } catch (error) {
    console.error('Rate limiting error:', error);
  }

  await next();
});

const routes = app
    .route('/email',email)
    .route('/gmail-webhook',webhook)
    .route('/activate-watch',watch)
    .route('/clerk',clerk)
    .route('/tags',tags)
    .route('/user',user)
    .route('/checkout',checkout)
    .route('/dodowebhook',dodowebhook)
    .route('/cron',cron)
    .route('/draft-preference',draftPreference)
    .route('/outlook',outlook)
    .route('/stats',stats)
    .route('/telegram',telegram)
    .route('/freeTrial',freeTrial)




export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;