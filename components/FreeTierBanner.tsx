"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { cn } from "@/lib/utils";
import { useUpsell } from "@/providers/UpsellProvider";
import { useTierAccess } from "@/features/user/use-tier-access";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useGetTeam } from "@/features/organization/use-get-team";
import { useFirstSweepPreview } from "@/features/first-sweep/use-first-sweep-preview";

// The dashboard carries <AddCardBanner/> inline, which makes the same ask with
// more room to explain it. Two nags on one screen is one too many.
const HIDDEN_EXACT = ["/"];

// Hidden on auth/onboarding routes (own the viewport) and /billing (plan cards are the page).
const HIDDEN_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/onboarding",
  "/onboard-complete",
  "/billing",
];

// DESIGN.md: ink fill for contrast without inventing a brand accent; §4 floating-surface shadow.
const PILL =
  "flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full bg-neutral-900 py-1 pl-3 pr-1 shadow-[0_4px_16px_rgba(0,0,0,0.24)]";

function Dot() {
  return (
    <span
      className="size-1.5 shrink-0 rounded-full bg-white animate-pulse motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

export function FreeTierBanner() {
  const pathname = usePathname();
  const { isFree, isResolved } = useTierAccess();

  // Unresolved tier reads as FREE — gate on isResolved or this flashes to paying users.
  if (!isResolved || !isFree) return null;
  if (HIDDEN_EXACT.includes(pathname ?? "")) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p))) return null;

  return <FreeTierBannerContent pathname={pathname ?? ""} />;
}

// Split out so useFirstSweepPreview (paginates threads.list, ~400 Gmail quota units) only runs for FREE users, not every page load.
function FreeTierBannerContent({ pathname }: { pathname: string }) {
  const { data: sub } = useGetUserSubscribed();
  const { data: team } = useGetTeam();
  const { data: sweep } = useFirstSweepPreview();
  const { openUpsell } = useUpsell();

  // Members get a 403 from POST /api/checkout — show them the explanation only, no CTA.
  const isMember = team?.role === "member";

  // Server-resolved (lib/subscription) — avoids re-offering a trial that already lapsed.
  const trialEligible = sub?.trialEligible === true;

  const sweepTotal = sweep?.eligible ? sweep.total : 0;

  // Sweep count costs one messages.list per bucket, no bodies/AI — safe to show pre-payment.
  const detail = isMember
    ? "Billing is managed by your admin — ask them to renew."
    : sweepTotal > 0
      ? `${sweepTotal.toLocaleString()} emails are waiting. Sorting, drafts and follow-ups are paused.`
      : "Sorting, drafts and follow-ups are paused. Your labels and rules are still here.";

  return (
    // z-40, below dialogs/toasts (z-50).
    <div
      role="status"
      className="fixed bottom-3 right-3 z-40
        animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
    >
      {/* Whole pill is the button, not just the chip, to meet the 48px touch-target minimum. */}
      {isMember ? (
        <div className={cn(PILL, "cursor-default")} title={detail}>
          <Dot />
          <span className="truncate text-xs font-medium text-white">
            Not subscribed — ask your admin
          </span>
        </div>
      ) : (
        <button
          type="button"
          title={detail}
          aria-label={`Not subscribed. ${trialEligible ? "Start free trial" : "Subscribe"}`}
          onClick={() => {
            posthog.capture("free_banner_clicked", {
              trialEligible,
              sweepTotal,
              path: pathname,
            });
            openUpsell("free_banner");
          }}
          className={cn(PILL, "group transition-colors hover:bg-neutral-800")}
        >
          <Dot />
          <span className="truncate text-xs font-medium text-white">
            Not subscribed
          </span>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-neutral-900 transition-colors group-hover:bg-neutral-200">
            {trialEligible ? "Start free trial" : "Subscribe"}
          </span>
        </button>
      )}
    </div>
  );
}
