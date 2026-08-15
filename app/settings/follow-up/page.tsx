"use client";

import FollowUpPreference from "@/components/FollowUpPreference";
import { PageHeader } from "@/components/PageHeader";

// Real form for everyone; the API refuses only the write — see app/settings/labels/page.tsx.
const page = () => {
  return (
    <>
      <PageHeader title="Follow-up" />
      <div className="w-full flex justify-center p-6 md:px-10">
        <div className="w-full">
          <FollowUpPreference />
        </div>
      </div>
    </>
  );
};

export default page;
