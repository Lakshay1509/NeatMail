"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Minus,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type StatTrend = {
  label: string;
  good: boolean;
  direction: "up" | "down" | "flat";
};

type StatCardProps = {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: StatTrend | null;
  isLoading?: boolean;
};

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  isLoading,
}: StatCardProps) {
  // Same two bands as the loaded card, so nothing shifts when data lands.
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-6 w-20" />
      </div>
    );
  }

  const TrendIcon =
    trend?.direction === "down"
      ? TrendingDown
      : trend?.direction === "up"
        ? TrendingUp
        : Minus;

  const trendColor =
    trend?.direction === "flat"
      ? "text-muted-foreground"
      : trend?.good
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive";

  /*
   * Two bands, both a fixed height: a single-line label, then the value with its
   * delta on the same baseline. Nothing here can wrap or go missing, so the
   * numbers land on the same line in every card of the row.
   *
   * The delta arrow is the card's only trend affordance — a sparkline alongside
   * it was a third read of the same fact, and at these card widths it rendered
   * as a strip of decoration rather than something anyone could read.
   */
  return (
    <div className="@container bg-card rounded-lg border p-4">
      <div className="flex h-4 items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <p className="min-w-0 truncate text-xs font-medium">{title}</p>
      </div>

      {/* items-end, not items-baseline: the delta is a flex row led by an SVG, so
          baseline alignment would synthesize its baseline from the icon's bottom
          edge and float the group above the number's floor. */}
      <div className="mt-2 flex items-end gap-2">
        <p className="text-xl @3xs:text-2xl font-semibold leading-none tabular-nums text-card-foreground">
          {value}
        </p>
        {trend && (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1 text-xs font-medium tabular-nums",
              trendColor
            )}
          >
            <TrendIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{trend.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
