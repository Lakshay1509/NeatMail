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
  Legend
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReadVsUnread() {
  const { data: response, isLoading, isError } = useGetReadVsUnread();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full h-[400px]">
        <div className="p-6 pb-2 border-b border-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Read vs Unread</h3>
            <p className="text-sm text-gray-500">Past 7 days</p>
          </div>
        </div>
        <div className="p-6 h-[320px]">
          <Skeleton className="w-full h-full" />
        </div>
      </div>
    );
  }

  if (isError || !response?.data) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full h-[400px] flex items-center justify-center text-gray-500">
        Failed to load read vs unread data.
      </div>
    );
  }

  const chartData = response.data;

  // Custom Legend
  const CustomLegend = () => {
    return (
      <div className="flex items-center justify-end gap-6 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
          <span className="text-sm font-medium text-gray-500">Read</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
          <span className="text-sm font-medium text-gray-500">Unread</span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm w-full h-[400px] flex flex-col">
      <div className="p-6 pb-0 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Read vs Unread</h3>
          <p className="text-sm text-gray-500 mt-1">Past 7 days</p>
        </div>
      </div>

      <div className="flex-1 p-6">
        <CustomLegend />
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
