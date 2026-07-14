"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Avatar from "boring-avatars";
import { Users, ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Same indigo palette as the /organization team avatars, for visual consistency.
const AVATAR_COLORS = ["#4f46e5", "#7c3aed", "#2563eb", "#0ea5e9", "#a5b4fc"];

// Where to send the user after the invite flow: returning users resolve to
// "dashboard", brand-new users fall through to "wizard".
export type InviteResolution = "dashboard" | "wizard";

type PreviewResponse = {
  alreadyOnboarded: boolean;
  invite:
    | { valid: false; reason: string }
    | {
        valid: true;
        organizationName: string;
        alreadyMember: boolean;
        self: boolean;
        blockedReason: "active_coverage" | "other_team" | "team_closing" | null;
        // The team the user will LEAVE if switching teams; null otherwise.
        switchingFrom: string | null;
      };
};

const BLOCKED_COPY: Record<
  "active_coverage" | "other_team" | "team_closing",
  string
> = {
  active_coverage:
    "You have an active subscription or trial. Cancel it before joining a team.",
  other_team:
    "You're already a member of another team. Leave it before joining this one.",
  team_closing: "This team is being closed and can't accept new members.",
};

/**
 * Invite confirmation gate on /onboarding for `?invite=<token>`. Previews the
 * invite, lets the user confirm/cancel, then resolves to "dashboard" or "wizard".
 */
export function InviteConfirm({
  token,
  onResolve,
}: {
  token: string;
  onResolve: (next: InviteResolution) => void;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [joining, setJoining] = useState(false);
  // Guard so the resolve callback (and the auto-resolve branches) fire once.
  const resolvedRef = useRef(false);

  const resolveOnce = (next: InviteResolution) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    // Drop the (now-handled) token from the URL so a reload doesn't re-prompt.
    window.history.replaceState({}, "", "/onboarding");
    onResolve(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/organization/invite/preview?token=${encodeURIComponent(token)}`,
        );
        const data: PreviewResponse = await res.json();
        if (cancelled) return;

        // Nothing to confirm: unusable/own invite, or already a member. Route onward.
        const nothingToConfirm =
          !data.invite.valid || data.invite.self || data.invite.alreadyMember;
        if (nothingToConfirm) {
          resolveOnce(data.alreadyOnboarded ? "dashboard" : "wizard");
          return;
        }
        setPreview(data);
      } catch {
        if (!cancelled) resolveOnce("wizard");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Returning users go back to their dashboard on cancel/block; new users continue onboarding.
  const dest = (): InviteResolution =>
    preview?.alreadyOnboarded ? "dashboard" : "wizard";

  const confirm = async () => {
    setJoining(true);
    try {
      const res = await fetch("/api/organization/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Could not join the team");
        setJoining(false);
        return;
      }
      // Raw fetch bypasses React Query's cache, so invalidate coverage/team
      // queries to avoid a stale "not subscribed" flash; await coverage since the parent has a live observer.
      await queryClient.invalidateQueries({ queryKey: ["user-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
      queryClient.invalidateQueries({ queryKey: ["organization-name"] });
      // Joined. Returning members skip onboarding; new members still set up.
      resolveOnce(dest());
    } catch {
      toast.error("Could not join the team");
      setJoining(false);
    }
  };

  // Loading / auto-resolving.
  if (!preview || preview.invite.valid !== true) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { organizationName, blockedReason, switchingFrom } = preview.invite;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-12 text-center">
      <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-1 ring-border">
        <Avatar
          name={organizationName}
          variant="marble"
          size={64}
          square
          colors={AVATAR_COLORS}
        />
      </span>

      {blockedReason ? (
        <>
          <div className="mt-5 flex size-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-500">
            <AlertCircle size={18} strokeWidth={2} />
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
            Can&apos;t join {organizationName}
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {BLOCKED_COPY[blockedReason]}
          </p>
          <Button
            variant="outline"
            className="mt-6 w-full"
            onClick={() => resolveOnce(dest())}
          >
            {preview.alreadyOnboarded ? "Back to dashboard" : "Continue setup"}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Users size={13} /> Team invitation
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            You&apos;re about to join{" "}
            <span className="text-foreground">{organizationName}</span>
          </h1>
          {switchingFrom && (
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-amber-600 dark:text-amber-500">
              You&apos;ll leave{" "}
              <span className="font-medium">{switchingFrom}</span> to join this
              team.
            </p>
          )}
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {preview.alreadyOnboarded ? (
              <>
                You&apos;ll join this team on their plan — all your labels,
                drafts, and settings stay exactly as they are. Nothing else to
                set up.
              </>
            ) : (
              <>
                You&apos;ll join this team and get full access on their plan.
                We&apos;ll walk you through a quick setup next.
              </>
            )}
          </p>

          <div className="mt-8 flex w-full flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="flex-1"
              disabled={joining}
              onClick={() => resolveOnce(dest())}
            >
              Cancel
            </Button>
            <Button className="flex-1" disabled={joining} onClick={confirm}>
              {joining ? (
                <>
                  <Loader2 className="animate-spin" /> Joining…
                </>
              ) : (
                <>
                  <ShieldCheck /> Confirm &amp; join
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
