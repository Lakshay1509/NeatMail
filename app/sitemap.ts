import type { MetadataRoute } from "next";

/**
 * Sitemap for the NeatMail app (dashboard.neatmail.app).
 *
 * Deliberately a single entry. Every other route is auth-gated (see proxy.ts),
 * so listing them would only submit URLs that all resolve to the same sign-in
 * redirect — Google treats that as duplicate/soft-404 content and it burns
 * crawl budget for nothing. /sign-in is the one page here that renders for an
 * anonymous visitor, and it's the one this host should rank for.
 *
 * The marketing sitemap (home, pricing, blog, comparisons, /for verticals, free
 * tools) is generated separately in the neatmail-landing repo and served from
 * www.neatmail.app/sitemap.xml. Keep the two apart: a sitemap may only list URLs
 * on its own host.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://dashboard.neatmail.app/sign-in",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
