import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bullmq", "ioredis", "libsodium-wrappers"],
  allowedDevOrigins: process.env.NEXT_PUBLIC_API_URL ? [new URL(process.env.NEXT_PUBLIC_API_URL).host] : [],
  // Skip type-checking during Docker builds on the VPS.
  // tsc spawns a separate worker that consumes ~1.5GB RAM — fatal on a 4GB machine.
  // Run `tsc --noEmit` locally or in CI (GitHub Actions) instead.
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [],
    localPatterns: [
      { pathname: '/**', search: '' },
    ],
    qualities: [75],
    maximumResponseBody: 5 * 1024 * 1024,
    maximumRedirects: 3,
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate, private" },
        ],
      },
      {
        source: "/:path*",
        has: [
          {
            type: 'header',
            key: 'accept',
            value: 'text/html',
          },
        ],
        headers: [
          { key: "Content-Type", value: "text/html; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate, private" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: `
    default-src 'self';

    script-src
      'self'
      'unsafe-inline'
      'unsafe-eval'
      *.vercel-scripts.com
      *.google.com
      *.gstatic.com
      *.cloudflareinsights.com
      *.clerk.dev
      *.clerk.com
      *.clerk.accounts.dev
      *.neatmail.app
      *.dodopayments.com
      http://localhost:8400
      blob:;

    style-src
      'self'
      'unsafe-inline'
      fonts.googleapis.com;

    font-src
      'self'
      fonts.gstatic.com;

    media-src
      'self'
      *.cloudinary.com;

    img-src
      'self'
      data:
      blob:
      *.clerk.dev
      *.clerk.com;

    connect-src
      'self'
      *.supabase.co
      *.clerk.dev
      *.clerk.com
      *.neatmail.app
      *.dodopayments.com
      *.dodo.com
      http://localhost:8400
      https:;

    frame-src
      'self'
      *.google.com
      *.clerk.dev
      *.clerk.com
      *.dodopayments.com;
  `.replace(/\n/g, ""),
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",

            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
