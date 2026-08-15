"use client";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpsell } from "@/providers/UpsellProvider";
import { cn } from "@/lib/utils";

// Deliberately quiet per DESIGN.md (achromatic, no shadow at rest) — this is a caption, not a nag; the top banner does the nagging.
interface GatedNoticeProps {
  /** What is locked, stated as a fact rather than a pitch. */
  title: string;
  /** What still works, and what unlocking changes. */
  description: string;
  /** Analytics label for which page raised the prompt. */
  source: string;
  action?: string;
  className?: string;
}

export function GatedNotice({
  title,
  description,
  source,
  action = "Unlock",
  className,
}: GatedNoticeProps) {
  const { openUpsell } = useUpsell();

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white">
          <Lock className="size-4 text-neutral-700" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-neutral-900">
            {title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
            {description}
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={() => openUpsell(source)}
        className="shrink-0 self-start sm:self-auto"
      >
        {action}
      </Button>
    </div>
  );
}
