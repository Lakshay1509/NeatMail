"use client";

import DigestSettings from "@/components/DigestSettings";
import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

function DigestGate() {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Daily digest requires Pro"
        description="Upgrade to Pro to receive a curated morning briefing of your most important emails."
      />
    );
  }

  return <DigestSettings />;
}

export default function DigestSettingsPage() {
  return (
    <div className="w-full p-6 md:px-10">
      <DigestGate />
    </div>
  );
}
