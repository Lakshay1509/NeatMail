import { clerkMiddleware,createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = 
createRouteMatcher([
  '/sign-in(.*)'
])

const isPublicApiRoute=createRouteMatcher([
  '/api/gmail-webhook/:path*',
  '/api/clerk/:path*',
  '/api/dodowebhook/:path*',
  '/api/cron/:path*'
])

export default clerkMiddleware(async(auth,req)=>{
  

  if(isPublicApiRoute(req) || isPublicRoute(req)){
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