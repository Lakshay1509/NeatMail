"use client";

import UserDraftPreference from "@/components/UserDraftPreference"
import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

function DraftPreferenceGate() {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Draft preferences require Pro"
        description="Upgrade to Pro to enable AI-powered email drafts with custom preferences."
      />
    );
  }

  return <UserDraftPreference />;
}

const page = () => {
  return (
    <div className="w-full flex justify-center p-6 md:px-10">
      <DraftPreferenceGate />
    </div>
  )
}

export default page
