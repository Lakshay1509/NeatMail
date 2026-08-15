"use client";

import DigestSettings from "@/components/DigestSettings";
import { PageHeader } from "@/components/PageHeader";

// Real form for everyone; the API refuses only the write — see app/settings/labels/page.tsx.
export default function DigestSettingsPage() {
  return (
    <>
      {/* Sole h1 for this page; DigestSettings no longer renders its own. */}
      <PageHeader title="Daily Digest" />
      <div className="w-full p-6 md:px-10">
        <div className="w-full">
          <DigestSettings />
        </div>
      </div>
    </>
  );
}
