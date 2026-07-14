import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)'
]);

const isPublicApiRoute = createRouteMatcher([
  '/api/gmail-webhook/:path*',
  '/api/clerk/:path*',
  '/api/dodowebhook/:path*',
  '/api/cron/:path*',
  '/api/outlook/:path*',
  '/api/email/all',
  '/api/telegram/webhook',
  '/api/slack/callback',
  '/api/bullboard/:path*',
  '/api/health/:path*',
]);

// Mirrors the code format defined in lib/referral.ts. Checked here (edge
// runtime, no DB access) before it's ever written to a cookie.
const REFERRAL_COOKIE_NAME = 'nm_ref';
const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6,10}$/;

// First-touch only: if a referral cookie is already set, a later `?ref=` link
// must never overwrite it.
function withReferralCookie(req: NextRequest, res: NextResponse): NextResponse {
  const refParam = req.nextUrl.searchParams.get('ref');
  if (!refParam || req.cookies.has(REFERRAL_COOKIE_NAME)) return res;

  const normalized = refParam.trim().toUpperCase();
  if (!REFERRAL_CODE_PATTERN.test(normalized)) return res;

  res.cookies.set(REFERRAL_COOKIE_NAME, normalized, {
    httpOnly: true,
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

// Captures `?invite=<token>` here (edge, no DB) so it survives the sign-in/sign-up
// redirect. Consumed server-side by POST /api/organization/join.
const INVITE_COOKIE_NAME = 'nm_invite';
const INVITE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // matches the 7-day invite TTL
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

// Last-touch: the most recent invite link a user clicks is the one they mean to
// accept, so overwrite any earlier value.
function withInviteCookie(req: NextRequest, res: NextResponse): NextResponse {
  const inviteParam = req.nextUrl.searchParams.get('invite');
  if (!inviteParam || !INVITE_TOKEN_PATTERN.test(inviteParam)) return res;

  res.cookies.set(INVITE_COOKIE_NAME, inviteParam, {
    httpOnly: true,
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

export default clerkMiddleware(async (auth, req) => {
  logger.info({
    method: req.method,
    path: req.nextUrl.pathname,
  });

  if (isPublicApiRoute(req) || isPublicRoute(req)) {
    // Initialize Clerk context for public routes so server helpers can read auth state safely.
    await auth();
  } else {
    await auth.protect();
  }

  return withInviteCookie(req, withReferralCookie(req, NextResponse.next()));
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};