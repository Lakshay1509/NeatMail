import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

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
  '/api/telegram/webhook',
]);

export default clerkMiddleware(async (auth, req) => {
  logger.info({
    method: req.method,
    path: req.nextUrl.pathname,
  });

  if (isPublicApiRoute(req) || isPublicRoute(req)) {
    // Initialize Clerk context for public routes so server helpers can read auth state safely.
    await auth();
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