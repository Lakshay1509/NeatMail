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
  '/api/cron/:path*'
]);

const isGmailWebhook = createRouteMatcher([
  '/api/gmail-webhook/:path*'
]);

const isApiRoute = createRouteMatcher([
  '/api/:path*'
]);

export default clerkMiddleware(async (auth, req) => {
  const identifier = getIdentifier(req);
  
  
  try {
    let rateLimitResult;

    
    if (isGmailWebhook(req)) {
      rateLimitResult = await gmailWebhookLimiter.limit(identifier);
    } 
    
    else if (isApiRoute(req)) {
      rateLimitResult = await apiLimiter.limit(identifier);
    } 
    
    else if (!isPublicRoute(req)) {
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