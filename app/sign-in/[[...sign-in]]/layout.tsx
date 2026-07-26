import type { Metadata } from "next"

const DESCRIPTION =
  "Sign in to NeatMail to track every promise in your Gmail or Outlook inbox — the ones you made and the ones made to you — with the follow-up drafted when it's due."

/**
 * Must stay byte-identical to the landing site's organizationSchema @id
 * (neatmail-landing, src/components/JsonLd.tsx). Same @id means crawlers merge
 * this node with the marketing site's instead of inferring two organizations
 * that happen to share a name.
 */
const ORGANIZATION_ID = "https://www.neatmail.app/#organization"

/**
 * Entity + page graph for the one crawlable URL on this host. The Organization
 * description is copied verbatim from the landing site so a crawler reading
 * dashboard.neatmail.app and www.neatmail.app gets the same promise from both.
 */
const signInJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: "NeatMail",
      url: "https://www.neatmail.app",
      description:
        "AI-powered email assistant that tracks every promise in your inbox and keeps Gmail and Outlook organized automatically.",
      sameAs: [
        "https://github.com/Lakshay1509/NeatMail",
        "https://news.ycombinator.com/item?id=47213836",
      ],
    },
    {
      "@type": "WebPage",
      "@id": "https://dashboard.neatmail.app/sign-in",
      url: "https://dashboard.neatmail.app/sign-in",
      name: "Sign in to NeatMail",
      description: DESCRIPTION,
      about: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
}

/**
 * The one indexable page on this host. The root layout sets a site-wide
 * noindex (everything else is auth-gated and would only ever render a sign-in
 * redirect); this overrides it so /sign-in can rank for brand login queries.
 *
 * The canonical is pinned to the bare /sign-in because Clerk's catch-all also
 * serves /sign-in/factor-one, /sign-in/sso-callback and other auth-flow steps —
 * they inherit this metadata, and without the canonical they would look like
 * duplicates of the sign-in page. robots.txt already keeps crawlers off them.
 */
export const metadata: Metadata = {
  title: { absolute: "Sign in to NeatMail" },
  description: DESCRIPTION,
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: "https://dashboard.neatmail.app/sign-in",
  },
  openGraph: {
    type: "website",
    siteName: "NeatMail",
    title: "Sign in to NeatMail",
    description: DESCRIPTION,
    url: "https://dashboard.neatmail.app/sign-in",
  },
}

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (

        <main>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(signInJsonLd) }}
          />
          {children}
        </main>

  )
}
