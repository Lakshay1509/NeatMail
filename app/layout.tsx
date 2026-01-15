import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs'
import "./globals.css";
import Navbar from "../components/Navbar";
import { QueryProviders } from "@/providers/QueryProvider";
import { Toaster } from "sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ConditionalSidebar } from "@/components/ConditionalSidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NeatMail - Your Inbox Deserves Better | Mail Automation Platform",
  description: "Label your emails directly into Gmail with AI-powered assistance. Stay organized with personalized labels and automated responses.",
  keywords: ["mail automation", "SaaS"],
  authors: [{ name: "NeatMail" }],
  openGraph: {
    type: "website",
    title: "NeatMail - Your Inbox Deserves Better",
    description: "Label your emails directly into Gmail with AI-powered assistance. Stay organized with personalized labels and automated responses.",
    url: "https://neatmail.tech",
    images: [
      {
        url: "https://neatmail.tech/og.webp",
        width: 1200,
        height: 630,
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "NeatMail - Your Inbox Deserves Better",
    description: "Label your emails directly into Gmail with AI-powered assistance. Stay organized with personalized labels and automated responses.",
  },
  alternates: {
    canonical: "https://neatmail.tech",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
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
          <QueryProviders>
            <SidebarProvider>
              <ConditionalSidebar />
              <main className="w-full">
                <Toaster richColors theme="light" />
                <Navbar />
                {children}
              </main>
            </SidebarProvider>
          </QueryProviders>
        </body>
      </html>
    </ClerkProvider>
  );
}
