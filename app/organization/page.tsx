"use client";

import Link from "next/link";

import TeamSettings from "@/components/TeamSettings";
import { NotSubscribedState } from "@/components/NotSubscribedState";
import { useGetTeam } from "@/features/organization/use-get-team";
import { Button } from "@/components/ui/button";

function TeamGate() {
  const { data, isLoading } = useGetTeam();

  // Wait for the team context to resolve so members (whose tier is materialised
  // to the team's plan) don't flash the upsell before the team view loads.
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

  // Access = you're on a team (member), or you own one with at least one seat.
  // seatLimit is the effective cap (see effectiveSeatCap): Max's included seat
  // plus any paid mailboxes, which are Max-only. A Pro owner has no seats and
  // doesn't get in; members of a Pro-owned team still do, since their own
  // access isn't tier-gated.
  const hasAccess =
    data?.role === "member" || (data?.role === "admin" && data.seatLimit > 0);

  if (!hasAccess) {
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
