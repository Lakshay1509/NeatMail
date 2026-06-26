"use client";

import { useGetUserTagsWeek } from "@/features/stats/use-get-user-tagsThisWeek";

export function LabelDistribution({ from, to }: { from?: string; to?: string }) {
  const { data: tags, isLoading } = useGetUserTagsWeek(from, to);

  const distributionColors = [
    "#0c5c49",
    "#1ea97f",
    "#5dc8a8",
    "#bfe8d8",
    "#e8f5f1",
  ];



  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-6 h-full flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-card-foreground" />
      </div>
    );
  }

  const topCategory = tags?.[0];

  return (
    <div className="bg-card rounded-lg border p-6 h-full">
      <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-0.5">
        Label Distribution
      </p>
      <p className="text-xs text-muted-foreground mb-6">
        Top:{" "}
        <span className="font-medium text-card-foreground">
          {topCategory?.label || "None"}
        </span>
      </p>

      <div className="space-y-6">
        {tags?.map((cat, index) => (
          <div key={cat.label}>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-card-foreground">{cat.label}</span>
              <span className="text-muted-foreground">{cat.percentage}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-secondary">
              <div
                className="h-2.5 rounded-full"
                style={{
                  width: `${cat.percentage}%`,
                  backgroundColor: distributionColors[index] || "#e8f5f1",
                }}
              />
            </div>
          </div>
        ))}
        {tags?.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">
            No label data for this week
          </div>
        )}
      </div>
    </div>
  );
}
