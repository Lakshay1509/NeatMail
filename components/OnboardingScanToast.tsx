"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Radar } from "lucide-react";

// Fired once when a just-onboarded user lands on the dashboard. The onboarding
// completion (POST /api/onboard) redirects here with ?scan=1 right after it
// queues a dedicated engagement scan for the user; this surfaces that work as a
// quick toast. Purely optimistic — the scan runs server-side and, if it finds
// any noisy senders, emails the user the count separately.
//
// On-system per DESIGN.md: achromatic Ink card with white copy (attention via
// contrast, not a brand accent color — the palette is achromatic by design).
// The lone radar sweep conveys the active scanning *state*, not decoration, and
// stops under prefers-reduced-motion. Shadow is the documented floating-surface
// token; no persistent decorative color or pulse.
export default function OnboardingScanToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("scan") !== "1") return;

    toast.custom(
      () => (
        <div className="flex w-full items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.12)] ring-1 ring-white/10">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <Radar className="size-[18px] animate-spin text-white [animation-duration:2.4s] motion-reduce:animate-none" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-white">
              Scanning for annoying senders
            </p>
            <p className="mt-0.5 text-xs leading-snug text-neutral-400">
              We&apos;ll auto-archive the ones you never open.
            </p>
          </div>
        </div>
      ),
      { duration: 7000 },
    );

    // Strip the flag so a refresh or back-navigation doesn't re-fire the toast.
    params.delete("scan");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : ""),
    );
  }, []);

  return null;
}
