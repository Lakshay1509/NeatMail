import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path",
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
      blob:;

    style-src
      'self'
      'unsafe-inline'
      fonts.googleapis.com;

    font-src
      'self'
      fonts.gstatic.com;

    img-src
      'self'
      data:
      blob:
      https:
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
