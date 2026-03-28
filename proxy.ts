import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { 
  gmailWebhookLimiter, 
  apiLimiter, 
  routeLimiter, 
  getIdentifier 
} from '@/lib/rate-limit';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)'
]);

const isPublicApiRoute = createRouteMatcher([
  '/api/gmail-webhook/:path*',
  '/api/clerk/:path*',
  '/api/dodowebhook/:path*',
  '/api/cron/:path*',
  '/api/inngest/:path*',
  '/api/outlook/:path*',
  '/api/email/all',
  '/api/telegram/webhook*'
]);

const isGmailWebhook = createRouteMatcher([
  '/api/gmail-webhook/:path*'
]);

const isApiRoute = createRouteMatcher([
  '/api/:path*'
]);

// Clerk's own internal routes during auth/logout — skip rate limiting
const isClerkInternalRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-out(.*)',
  '/api/clerk(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const identifier = getIdentifier(req, userId);
  
  
  try {
    let rateLimitResult;

    if (isClerkInternalRoute(req)) {
      // skip rate limiting for Clerk auth/logout flows
    } else if (isGmailWebhook(req)) {
      rateLimitResult = await gmailWebhookLimiter.limit(identifier);
    } else if (isApiRoute(req)) {
      rateLimitResult = await apiLimiter.limit(identifier);
    } else if (!isPublicRoute(req)) {
      rateLimitResult = await routeLimiter.limit(identifier);
    }

   
    if (rateLimitResult && !rateLimitResult.success) {
      return new NextResponse(
        JSON.stringify({
          error: 'Too many requests',
          message: 'Please try again later'
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
          },
        }
      );
    }
  } catch (error) {
    
    console.error('Rate limiting error:', error);
  }

 
  if (isPublicApiRoute(req) || isPublicRoute(req)) {
    return;
  }

  
  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};