"use client";

import { useGetUserMailsByDay } from "@/features/stats/use-get-mails-ByDay";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export default function MailsByDay() {
  const { data: response, isLoading, isError } = useGetUserMailsByDay();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 w-full h-[400px]">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (isError || !response?.data) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 w-full h-[400px] flex items-center justify-center text-gray-500">
        Failed to load labelled emails data.
      </div>
    );
  }

  const chartData = response.data;

  // Custom Legend matching the screenshot styling
  const CustomLegend = () => {
    return (
      <div className="flex items-center justify-end gap-6 mb-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#1ea97f]"></div>
          <span className="text-sm font-medium text-gray-500">Total</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-pink-500"></div>
          <span className="text-sm font-medium text-gray-500">Time Saved (s)</span>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 w-full">
      {/* Header matching the screenshot UI */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Labeled Emails & Time Saved
        </h2>
        
      </div>

      <CustomLegend />

      <div className="h-[300px] w-full mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 20, right: 0, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            
            <XAxis 
              dataKey="date" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }}
              dy={10}
            />
            
            {/* Left Y-axis for Total Bars */}
            <YAxis 
              yAxisId="left" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12, fontWeight: 600 }}
              tickFormatter={(value) => `${value}`}
            />
            
            {/* Right Y-axis for Time Saved Line */}
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              axisLine={false} 
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12, fontWeight: 600 }}
              tickFormatter={(value) => `${value}s`}
            />

            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: '1px solid #f0f0f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ fontWeight: 500 }}
              labelStyle={{ fontWeight: 600, color: '#374151', marginBottom: '4px' }}
            />

            <Bar 
              yAxisId="left" 
              dataKey="total" 
              fill="#1ea97f" 
              name="Total" 
              radius={[6, 6, 0, 0]} 
              barSize={40}
            />
            <Line 
              yAxisId="right" 
              type="linear" 
              dataKey="timeSaved" 
              stroke="#EC4899" 
              strokeWidth={3} 
              dot={false}
              activeDot={{ r: 6, fill: "#EC4899", strokeWidth: 0 }} 
              name="Time Saved (s)" 
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
