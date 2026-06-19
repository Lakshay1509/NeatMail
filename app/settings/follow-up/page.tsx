"use client";

import FollowUpPreference from "@/components/FollowUpPreference";
import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

function FollowUpGate() {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Follow-ups require Pro"
        description="Upgrade to Pro to enable automatic follow-up detection and AI draft generation."
      />
    );
  }

  return <FollowUpPreference />;
}

const page = () => {
  return (
    <div className="w-full flex justify-center p-6 md:px-10">
      <FollowUpGate />
    </div>
  );
};

export default page;
