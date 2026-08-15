"use client";

import UserDraftPreference from "@/components/UserDraftPreference"
import { PageHeader } from "@/components/PageHeader";

// Real form for everyone; the API refuses only the write — see app/settings/labels/page.tsx.
const page = () => {
  return (
    <>
      <PageHeader title="Draft preference" />
      <div className="w-full flex justify-center p-6 md:px-10">
        <div className="w-full">
          <UserDraftPreference />
        </div>
      </div>
    </>
  )
}

export default page
