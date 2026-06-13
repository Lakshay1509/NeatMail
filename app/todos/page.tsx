"use client";

import DigestSection from "@/components/Dashboard/DigestSection";
import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

function TodosGate() {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Todos require Pro"
        description="Upgrade to Pro to track follow-ups and action items from your inbox."
      />
    );
  }

  return <DigestSection />;
}

export default function Todos() {
  return (
    <div className="w-full p-6 md:px-10">
      <TodosGate />
    </div>
  );
}
