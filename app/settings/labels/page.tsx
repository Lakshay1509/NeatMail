"use client";

import UserLabelSettings from "@/components/UserLabelSettings"
import { PageHeader } from "@/components/PageHeader";

// FREE users get the real page; only writes are gated. The API refuses them and lib/hono routes that into the upsell modal via UpsellProvider.
const page = () => {
  return (
    <>
      <PageHeader title="Labels" />
      <div className="w-full flex justify-center p-6 md:px-10">
        <div className="w-full">
          <UserLabelSettings />
        </div>
      </div>
    </>
  )
}

export default page
