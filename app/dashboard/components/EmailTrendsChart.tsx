"use client";

import { useGetUserWeekEmails } from "@/features/email/use-get-user-thisWeek";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export function EmailTrendsChart() {
  const { data, isLoading, isError } = useGetUserWeekEmails();

  const chartData = [
    { day: "Mon", emails: data?.Monday ?? 0 },
    { day: "Tue", emails: data?.Tuesday ?? 0 },
    { day: "Wed", emails: data?.Wednesday ?? 0 },
    { day: "Thu", emails: data?.Thursday ?? 0 },
    { day: "Fri", emails: data?.Friday ?? 0 },
    { day: "Sat", emails: data?.Saturday ?? 0 },
    { day: "Sun", emails: data?.Sunday ?? 0 },
  ];

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full flex items-center justify-center text-red-500">
        Error loading chart data
      </div>
    );
  }

  const totalEmails = data
    ? Object.values(data).reduce((acc, curr) => acc + curr, 0)
    : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-bold text-gray-900 text-lg">Email Trends</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-bold text-gray-900">
              {totalEmails}
            </span>
            <span className="text-sm text-gray-500">emails this week</span>
          </div>
        </div>
        <div className="px-3 py-1 bg-gray-100 rounded-md text-xs font-medium text-gray-600">
          Current Week
        </div>
      </div>

      <div className="h-[250px] w-full mt-auto">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorEmails" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "none",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="emails"
              stroke="#3b82f6"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorEmails)"
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
              dy={10}
              padding={{ left: 20, right: 20 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
