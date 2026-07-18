"use client";

import { useState } from "react";
import { Archive, Loader2, Undo2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFirstSweepPreview } from "@/features/first-sweep/use-first-sweep-preview";
import { useRunFirstSweep } from "@/features/first-sweep/use-run-first-sweep";
import { useUndoFirstSweep } from "@/features/first-sweep/use-undo-first-sweep";

type Phase = "idle" | "done";

const FirstRunSweepBanner = () => {
  const { data, isLoading } = useFirstSweepPreview();
  const run = useRunFirstSweep();
  const undo = useUndoFirstSweep();

  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  // Captured on click so the confirmation survives the preview query going stale.
  const [sweptCount, setSweptCount] = useState(0);

  // While idle we defer to the server's eligibility; once fired we take over
  // locally, since the preview flips to ineligible the moment the account is stamped.
  if (phase === "idle" && (isLoading || dismissed || !data?.eligible)) {
    return null;
  }

  const total = data?.total ?? 0;
  const buckets = (data?.buckets ?? []).filter((b) => b.count > 0);

  const handleSweep = () => {
    setSweptCount(total);
    setPhase("done");
    run.mutate(undefined);
  };

  const handleUndo = () => {
    undo.mutate();
    setDismissed(true);
    setPhase("idle");
  };

  // Shared shell: a single quiet raised strip. Flat at rest (no shadow), hairline
  // border, achromatic surface — depth via the surface ramp, not colour.
  const shell =
    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200 " +
    "flex flex-col gap-3 rounded-lg border border-border bg-muted/60 px-4 py-3 sm:flex-row sm:items-center sm:gap-4";

  // ── Confirmation ─────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className={shell}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
            <Check className="size-[18px]" />
          </span>
          <p className="text-sm text-foreground">
            Clearing{" "}
            <span className="font-semibold tabular-nums">
              {sweptCount.toLocaleString()}
            </span>{" "}
            {sweptCount === 1 ? "email" : "emails"} out of your inbox — nothing
            deleted, it&apos;s all in All&nbsp;Mail.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUndo}
          disabled={undo.isPending}
          className="self-end sm:self-auto"
        >
          <Undo2 className="size-4" />
          Undo
        </Button>
      </div>
    );
  }

  // ── Offer ────────────────────────────────────────────────────────────────
  return (
    <div className={shell}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
          <Archive className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            <span className="font-semibold tabular-nums">
              {total.toLocaleString()}
            </span>{" "}
            {total === 1 ? "email is" : "emails are"} cluttering your inbox
          </p>
          <p className="mt-0.5 text-sm leading-snug text-foreground/70">
            {buckets.length > 0 && (
              <>
                {buckets
                  .map((b) => `${b.count.toLocaleString()} ${b.label}`)
                  .join(" · ")}
                {" — "}
              </>
            )}
            none need a reply. Archive them in one click; nothing is deleted.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 self-end sm:self-auto">
        <Button size="sm" onClick={handleSweep} disabled={run.isPending}>
          {run.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Archive className="size-4" />
          )}
          Clear my inbox
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-muted-foreground"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
};

export default FirstRunSweepBanner;
