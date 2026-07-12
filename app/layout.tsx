import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs'
import "./globals.css";
import Navbar from "../components/Navbar";
import { QueryProviders } from "@/providers/QueryProvider";
import { Toaster } from "sonner";
import { SidebarProvider} from "@/components/ui/sidebar";
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

export const metadata: Metadata = {
  title: "NeatMail — AI Email Assistant for Inbox Zero",
  description: "NeatMail is an AI-powered email assistant that triages, drafts, and clears your inbox so you reach zero — fast.",
  keywords: ["mail automation", "SaaS"],
  authors: [{ name: "NeatMail" }],
  openGraph: {
    type: "website",
    title: "NeatMail — AI Email Assistant for Inbox Zero",
    description: "NeatMail is an AI-powered email assistant that triages, drafts, and clears your inbox so you reach zero — fast.",
    url: "https://neatmail.app",
    images: [
      {
        url: "https://neatmail.app/og.webp",
        width: 1200,
        height: 630,
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "NeatMail — AI Email Assistant for Inbox Zero",
    description: "NeatMail is an AI-powered email assistant that triages, drafts, and clears your inbox so you reach zero — fast.",
  },
  alternates: {
    canonical: "https://neatmail.app",
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
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <PostHogIdentify />
          <QueryProviders>
            <SidebarProvider>
              <ConditionalSidebar />
              <main className="w-full">
                <Toaster richColors theme="light" />
                <Navbar />
                <PageTransition>{children}</PageTransition>
              </main>
            </SidebarProvider>
          </QueryProviders>
        </body>
      </html>
    </ClerkProvider>
  );
}
