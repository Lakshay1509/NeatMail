import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs'
import "./globals.css";
import { QueryProviders } from "@/providers/QueryProvider";
import { Toaster } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ConditionalSidebar } from "@/components/ConditionalSidebar";
import PageTransition from "@/components/PageTransition";
import { PostHogIdentify } from "@/components/PostHogIdentify";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

const TITLE = "NeatMail — Promise Tracking for Gmail & Outlook";
const DESCRIPTION =
  "Never drop a promise buried in your inbox. NeatMail catches every commitment — yours and theirs — files it under one Follow up label, and drafts the follow-up.";

export const metadata: Metadata = {
  metadataBase: new URL("https://dashboard.neatmail.app"),
  // `template` applies to any page that sets its own title; `default` covers the rest.
  title: { default: TITLE, template: "%s · NeatMail" },
  description: DESCRIPTION,
  applicationName: "NeatMail",
  keywords: [
    "promise tracking",
    "email follow-up tracking",
    "AI email assistant",
    "Gmail",
    "Outlook",
  ],
  authors: [{ name: "NeatMail" }],
  // Every route in this app is auth-gated (see proxy.ts) — a crawler only ever
  // reaches the sign-in redirect. Keeping it out of the index stops those
  // near-empty pages from competing with the marketing site at neatmail.app.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    siteName: "NeatMail",
    title: TITLE,
    description: DESCRIPTION,
    url: "https://dashboard.neatmail.app",
    images: [{ url: "/og.webp", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.webp"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // SidebarProvider persists the expanded/collapsed choice to `sidebar_state`
  // but never reads it back. Seeding defaultOpen from the cookie here is what
  // makes the icon-collapsed state survive a reload instead of flashing back
  // to full width on every navigation that re-renders the shell.
  const sidebarOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <PostHogIdentify />
          <QueryProviders>
            <SidebarProvider defaultOpen={sidebarOpen}>
              <ConditionalSidebar />
              {/* SidebarInset (not a bare <main>) so the content column shrinks
                  and grows with the sidebar's expanded/icon state. */}
              <SidebarInset className="min-w-0">
                <Toaster richColors theme="light" />
                <PageTransition>{children}</PageTransition>
              </SidebarInset>
            </SidebarProvider>
          </QueryProviders>
        </body>
      </html>
    </ClerkProvider>
  );
}
