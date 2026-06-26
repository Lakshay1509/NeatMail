"use client";

import type { ReactNode } from "react";
import { useGetTrafficHeatmap } from "@/features/stats/use-get-traffic-heatmap";
import { useGetClutter } from "@/features/stats/use-get-clutter";
import { useGetEmailStatus } from "@/features/stats/use-get-email-status";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays,
  Clock,
  BellOff,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";

const DOW = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHour(h: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr} ${ampm}`;
}

function formatSource(raw: string): string {
  // "Google <no-reply@accounts.google.com>" → "Google"
  const nameMatch = raw.match(/^(.+?)\s*</);
  if (nameMatch) return nameMatch[1].trim().split(/\s+/)[0];
  // "support@acme.in" → "acme.in"
  const atIdx = raw.indexOf("@");
  if (atIdx !== -1) return raw.slice(atIdx + 1);
  return raw;
}

type Insight = {
  tag: string;
  icon: LucideIcon;
  value: ReactNode;
  caption: string;
};

export function InsightHighlights({ from, to }: { from?: string; to?: string }) {
  const heat = useGetTrafficHeatmap(from, to);
  const clutter = useGetClutter(from, to);
  const emailStatus = useGetEmailStatus(from, to);

  const isLoading = heat.isLoading || clutter.isLoading || emailStatus.isLoading;

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card px-6 py-4">
        <Skeleton className="h-3 w-40 mb-5" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const traffic = heat.data?.trafficData ?? [];

  let peak = { dow: -1, hour: -1, count: 0 };
  const dayTotals = new Array(7).fill(0);
  for (const t of traffic) {
    const dow = Number(t.day_of_week);
    const hour = Number(t.hour_of_day);
    const c = Number(t.email_count);
    if (dow >= 0 && dow < 7) dayTotals[dow] += c;
    if (c > peak.count) peak = { dow, hour, count: c };
  }
  const hasTraffic = peak.count > 0;

  let busiestDay = -1;
  let quietestDay = -1;
  let maxD = -1;
  let minD = Infinity;
  dayTotals.forEach((tot, d) => {
    if (tot > maxD) { maxD = tot; busiestDay = d; }
    if (tot > 0 && tot < minD) { minD = tot; quietestDay = d; }
  });

  const topClutter = clutter.data?.clutterData?.[0];
  const statusData = emailStatus.data;
  const cleared = (statusData?.done ?? 0) + (statusData?.archived ?? 0);
  const totalMail = statusData?.total ?? 0;

  const insights: Insight[] = [];

  if (hasTraffic) {
    insights.push({
      tag: "Peak traffic",
      icon: Clock,
      value: `${DOW_SHORT[peak.dow]} · ${formatHour(peak.hour)}`,
      caption: "When most of your mail lands",
    });
  }

  if (busiestDay >= 0 && maxD > 0) {
    insights.push({
      tag: "Busiest day",
      icon: CalendarDays,
      value: DOW[busiestDay],
      caption:
        quietestDay >= 0 && quietestDay !== busiestDay
          ? `${DOW[quietestDay]} is your calmest`
          : "Your heaviest inbox day",
    });
  }

  if (topClutter) {
    insights.push({
      tag: "Top noise",
      icon: BellOff,
      value: formatSource(topClutter.domain),
      caption: `${topClutter.unreadCount} unread · noisiest source`,
    });
  }

  if (cleared > 0) {
    insights.push({
      tag: "Cleared",
      icon: CheckCheck,
      value: cleared,
      caption: "emails marked done or archived",
    });
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-4">
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
          What your inbox looks like
        </p>
        <p className="text-sm text-muted-foreground mt-3">
          Not enough activity yet — check back once more email lands.
        </p>
      </div>
    );
  }

  const cols =
    insights.length === 4
      ? "grid-cols-2 sm:grid-cols-4"
      : insights.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-2";

  return (
    <div className="rounded-lg border bg-card px-6 py-4">
      <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-5">
        What your inbox looks like
      </p>

      <div className={`grid ${cols} sm:divide-x sm:divide-border gap-y-5`}>
        {insights.map((ins) => {
          const Icon = ins.icon;
          return (
            <div
              key={ins.tag}
              className="sm:px-6 sm:first:pl-0 sm:last:pr-0 flex flex-col gap-1"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                  {ins.tag}
                </span>
              </div>
              <p className="text-lg font-semibold text-card-foreground tabular-nums leading-none tracking-tight truncate">
                {ins.value}
              </p>
              <p className="text-xs text-muted-foreground/70 leading-snug mt-0.5">
                {ins.caption}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
