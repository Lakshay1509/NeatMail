"use client";

import Link from "next/link";

import TeamSettings from "@/components/TeamSettings";
import { NotSubscribedState } from "@/components/NotSubscribedState";
import { useTierAccess } from "@/features/user/use-tier-access";
import { Button } from "@/components/ui/button";

function TeamGate() {
  const { isMax, isLoading } = useTierAccess();

  // Wait for the tier to resolve so members (whose tier is materialised to the
  // team's plan) don't flash the upsell before the team view loads.
  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3.5">
          <div className="size-11 animate-pulse rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-44 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-8 h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // Team seats are a Max-only feature (FREE 0, PRO 0, MAX +1 seat).
  if (!isMax) {
    return (
      <div className="mx-auto max-w-md">
        <NotSubscribedState
          tier="MAX"
          title="Team is a Max feature"
          description="Invite a teammate to share your NeatMail plan. Upgrade to Max to add a seat to your account."
          action={
            <Button asChild>
              <Link href="/billing">Upgrade to Max</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <TeamSettings />;
}

const page = () => {
  return (
    <div className="w-full px-4 py-6 sm:px-6 md:px-10 md:py-8">
      <TeamGate />
    </div>
  );
};

export default page;
