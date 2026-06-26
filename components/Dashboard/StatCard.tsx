"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";

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
  sparkline?: number[];
  accent?: string;
  isLoading?: boolean;
};

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  sparkline,
  accent = "#10b981",
  isLoading,
}: StatCardProps) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4 min-h-[116px]">
        <Skeleton className="h-3 w-24 mb-4" />
        <Skeleton className="h-7 w-20 mb-2" />
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const sparkData = (sparkline ?? []).map((v, i) => ({ i, v }));
  const gradientId = `spark-${title.replace(/[^a-z0-9]/gi, "-")}`;

  const TrendIcon =
    trend?.direction === "down"
      ? ArrowDown
      : trend?.direction === "up"
        ? ArrowUp
        : Minus;

  const trendColor =
    trend?.direction === "flat"
      ? "text-muted-foreground"
      : trend?.good
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-destructive";

  const sparkline$ = sparkData.length > 1 && (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={accent}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );

  return (
    <div className="bg-card rounded-lg border p-4 flex flex-col justify-between overflow-hidden min-h-[116px]">
      {/* Title row */}
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Icon className="w-3.5 h-3.5 text-muted-foreground/50" />
      </div>

      {/* Body: stacks on mobile, side-by-side on sm+ */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between sm:gap-3 mt-2 gap-1.5">
        <div className="min-w-0">
          {/* Value row — trend sits inline on mobile (sm:hidden), below on desktop */}
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold text-card-foreground tabular-nums leading-none">
              {value}
            </p>
            {/* Mobile-only inline trend */}
            {trend && (
              <div className={cn("flex sm:hidden items-center gap-0.5 text-[11px] font-medium shrink-0", trendColor)}>
                <TrendIcon className="w-3 h-3" />
                <span className="whitespace-nowrap">
                  {trend.label.replace(/ vs prev$/, "")}
                </span>
              </div>
            )}
          </div>

          {/* Desktop-only stacked trend */}
          {trend && (
            <div className={cn("hidden sm:flex items-center gap-1 mt-1 text-xs font-medium", trendColor)}>
              <TrendIcon className="w-3 h-3" />
              <span>{trend.label}</span>
            </div>
          )}
        </div>

        {/* Sparkline: full-width below on mobile, fixed 96px on the right on sm+ */}
        {sparkData.length > 1 && (
          <div className="w-full h-8 sm:w-24 sm:h-10 sm:shrink-0">
            {sparkline$}
          </div>
        )}
      </div>
    </div>
  );
}
