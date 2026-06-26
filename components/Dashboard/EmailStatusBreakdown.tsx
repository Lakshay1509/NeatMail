"use client";

import { useGetUnreadBreakdown } from "@/features/stats/use-get-unread-breakdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

const FALLBACK_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#64748b",
];

const CardShell = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-card rounded-lg border w-full flex flex-col overflow-hidden">
    {children}
  </div>
);

export default function EmailStatusBreakdown({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  const { data, isLoading, isError } = useGetUnreadBreakdown(from, to);

  if (isLoading) {
    return (
      <CardShell>
        <div className="px-6 pt-5 pb-0">
          <Skeleton className="h-3 w-36 mb-1.5" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="w-full h-full rounded-lg" />
        </div>
      </CardShell>
    );
  }

  if (isError || !data) {
    return (
      <CardShell>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Failed to load unread breakdown.
        </div>
      </CardShell>
    );
  }

  const total = data.total ?? 0;
  const breakdown = (data.breakdown ?? []).map((item, i) => ({
    ...item,
    color: item.color && item.color !== "#000000" ? item.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));

  const top = breakdown[0];
  const topPct = total > 0 && top ? Math.round((top.count / total) * 100) : 0;

  return (
    <CardShell>
      <div className="px-6 pt-5 pb-0">
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
          Unread Breakdown
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          What&apos;s piling up in your inbox
        </p>
      </div>

      {total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-center px-6">
          <p className="text-sm font-medium text-card-foreground">Inbox clear</p>
          <p className="text-xs text-muted-foreground">No unread emails in this period.</p>
        </div>
      ) : breakdown.length === 1 && breakdown[0].label === "Unlabeled" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-center px-6">
          <img src="/mascot/labels.svg" alt="Ray mascot" className="w-60 h-60" />
          <p className="text-xs text-muted-foreground leading-snug">
            Ray will organize incoming mail —<br />check back in a few hours.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col sm:flex-row items-center gap-5 px-6 py-4 min-h-0">
          {/* Donut */}
          <div className="relative w-[148px] h-[148px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdown}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={72}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {breakdown.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-semibold text-card-foreground tabular-nums leading-none">
                {total}
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5">unread</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 w-full space-y-0 min-w-0">
            {/* Top callout */}
            {top && (
              <div className="mb-3 px-3 py-2 rounded-md bg-muted/50 border border-border/60">
                <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wide font-medium">
                  Biggest pile
                </p>
                <p className="text-xs text-card-foreground mt-0.5">
                  <span className="font-semibold">{top.label}</span>{" "}
                  makes up{" "}
                  <span className="font-semibold">{topPct}%</span>{" "}
                  of your unread
                </p>
              </div>
            )}

            {/* Rows */}
            {breakdown.map((d) => {
              const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
              return (
                <div key={d.label} className="py-1.5 ">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="text-card-foreground truncate font-medium">{d.label}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 ml-2">
                      <span className="text-muted-foreground tabular-nums">{d.count}</span>
                      <span className="text-muted-foreground/50 tabular-nums w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="h-0.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: d.color, opacity: 0.7 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </CardShell>
  );
}
