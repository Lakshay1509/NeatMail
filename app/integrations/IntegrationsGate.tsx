"use client";

import { useTierAccess } from "@/features/user/use-tier-access";
import { NotSubscribedState } from "@/components/NotSubscribedState";

export function IntegrationsGate({ children }: { children: React.ReactNode }) {
  const { isFree } = useTierAccess();

  if (isFree) {
    return (
      <NotSubscribedState
        tier="FREE"
        title="Integrations require Pro"
        description="Upgrade to Pro to connect Telegram and Slack for real-time notifications and draft confirmation."
      />
    );
  }

  return <>{children}</>;
}
