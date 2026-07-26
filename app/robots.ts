import type { MetadataRoute } from "next";

/**
 * robots.txt for the NeatMail app (dashboard.neatmail.app).
 *
 * Everything on this host is behind Clerk auth (see proxy.ts) except the sign-in
 * page, so /sign-in is the only URL a crawler can actually render — and the only
 * one worth indexing (it serves "neatmail login"-style brand queries). Everything
 * else would resolve to a sign-in redirect, i.e. duplicate near-empty pages
 * competing with the marketing site, so the rest of the origin is disallowed.
 *
 * `/sign-in$` is anchored on purpose: Clerk's catch-all also serves
 * /sign-in/factor-one, /sign-in/sso-callback and friends. Those are auth-flow
 * steps, never landing pages, and the `$` keeps crawlers off them while leaving
 * the sign-in page itself open. (Google and Bing both honour `$` and `*`.)
 *
 * Marketing content, the full page sitemap and the AI-crawler rules live on
 * www.neatmail.app (the neatmail-landing repo) — this file only ever speaks for
 * its own host.
 *
 * NOTE: /robots.txt and /sitemap.xml are both allow-listed in proxy.ts. Neither
 * `.txt` nor `.xml` is in the middleware matcher's static-file exclusion list,
 * so without that auth.protect() would redirect crawlers to sign-in instead of
 * serving these files.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/sign-in$",
        disallow: "/",
      },
    ],
    sitemap: "https://dashboard.neatmail.app/sitemap.xml",
    host: "https://dashboard.neatmail.app",
  };
}
