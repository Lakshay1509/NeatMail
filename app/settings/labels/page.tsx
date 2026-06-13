"use client";

import UserLabelSettings from "@/components/UserLabelSettings"
import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

function LabelsGate() {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Labels & watch require Pro"
        description="Upgrade to Pro to set up inbox watch and customize your email categories."
      />
    );
  }

  return <UserLabelSettings />;
}

const page = () => {
  return (
    <div className="w-full flex justify-center p-6 md:px-10">
      <LabelsGate />
    </div>
  )
}

export default page
