"use client";

import { useGetUserTagsWeek } from "@/features/email/use-get-user-tagsThisWeek";

export function LabelDistribution() {
  const { data: tags, isLoading } = useGetUserTagsWeek();

  console.log(tags)

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    );
  }

  const topCategory = tags?.[0];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full">
      <h3 className="font-bold text-gray-900 text-lg mb-1">Label Distribution</h3>
      <p className="text-sm text-gray-500 mb-8">
        Top category:{" "}
        <span className="font-medium text-gray-900">
          {topCategory?.label || "None"}
        </span>
      </p>

      <div className="space-y-6">
        {tags?.map((cat) => (
          <div key={cat.label}>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">{cat.label}</span>
              <span className="text-gray-500">{cat.percentage}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-gray-100">
              <div
                className="h-2.5 rounded-full"
                style={{
                  width: `${cat.percentage}%`,
                  backgroundColor: cat.color,
                }}
              />
            </div>
          </div>
        ))}
        {tags?.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-4">
            No label data for this week
          </div>
        )}
      </div>
    </div>
  );
}
