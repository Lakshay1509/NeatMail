"use client";

import { useGetReadVsUnread } from "@/features/stats/use-get-read-vs-unread";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

function ChartLegend() {
  return (
    <div className="flex items-center justify-end gap-6 mb-2">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-emerald-500" />
        <span className="text-sm font-medium text-muted-foreground">Read</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-blue-500" />
        <span className="text-sm font-medium text-muted-foreground">Unread</span>
      </div>
    </div>
  );
}

export default function ReadVsUnread({ from, to }: { from?: string; to?: string }) {
  const { data: response, isLoading, isError } = useGetReadVsUnread(from, to);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border w-full h-[400px]">
        <div className="p-6 pb-2 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold text-card-foreground">Read vs Unread</h3>
        </div>
        <div className="p-6 h-[320px]">
          <Skeleton className="w-full h-full" />
        </div>
      </div>
    );
  }

  if (isError || !response?.data) {
    return (
      <div className="bg-card rounded-lg border w-full h-[400px] flex items-center justify-center text-muted-foreground">
        Failed to load read vs unread data.
      </div>
    );
  }

  const chartData = response.data;

  return (
    <div className="bg-card rounded-lg border w-full h-[400px] flex flex-col">
      <div className="p-6 pb-0 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-card-foreground">Read vs Unread</h3>
      </div>

      <div className="flex-1 p-6">
        <ChartLegend />
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6B7280", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "transparent" }}
              contentStyle={{
                backgroundColor: "#fff",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                padding: "12px",
              }}
              itemStyle={{ fontSize: "14px", fontWeight: 500 }}
              labelStyle={{ color: "#6B7280", marginBottom: "4px" }}
            />
            <Bar
              dataKey="read"
              name="Read"
              fill="#10b981"
              radius={[4, 4, 4, 4]}
              barSize={32}
              stackId="a"
            />
            <Bar
              dataKey="unread"
              name="Unread"
              fill="#3b82f6"
              radius={[4, 4, 4, 4]}
              barSize={32}
              stackId="a"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
