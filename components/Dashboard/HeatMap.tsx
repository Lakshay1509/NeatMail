'use client';

import { useGetTrafficHeatmap } from "@/features/stats/use-get-traffic-heatmap";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb } from "lucide-react";

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOURS = [
  '08:00', '10:00', '12:00', '14:00', '16:00', '18:00',
  '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'
];

const HeatMap = () => {
  const { data, isLoading, isError } = useGetTrafficHeatmap();

  if (isLoading) {
    return <Skeleton className="w-full h-80 rounded-xl" />;
  }

  if (isError) {
    return <div className="p-6 text-red-500 rounded-xl border">Failed to load heatmap data.</div>;
  }

  // Group data by day (1-7, assuming Monday is 1, or 0-6). Let's assume 0=Monday to 6=Sunday for mapping or adapt based on JS getDay (0=Sun). 
  // We'll normalize to 0=MON, 6=SUN.
  const getTrafficColor = (count: number, maxCount: number) => {
    if (count === 0) return 'bg-slate-100 dark:bg-slate-800';
    const ratio = count / maxCount;
    if (ratio < 0.25) return 'bg-indigo-50 dark:bg-indigo-950';
    if (ratio < 0.5) return 'bg-indigo-200 dark:bg-indigo-800';
    if (ratio < 0.75) return 'bg-indigo-500 dark:bg-indigo-600';
    return 'bg-indigo-700 dark:bg-indigo-500';
  };


  // Convert hours to 12 buckets (each bucket is 2 hours).
  // Starting at 08:00. Bucket 0 = 08-09, Bucket 1 = 10-11, ... Bucket 11 = 06-07.
  const buckets = Array(7).fill(0).map(() => Array(12).fill(0));
  let maxCount = 1; // avoid division by zero

  // To find optimal focus time
  const bucketTotals = Array(12).fill(0);

  if (data?.trafficData) {
    data.trafficData.forEach((item) => {
      // Assuming day_of_week is 0-6 where 0 is Monday (or 1-7). Modify if different.
      // If 1=Monday, 7=Sunday:
      const dayOfWeek = Number(item.day_of_week);
      let dayIdx = dayOfWeek;
      // Adjust standard 0=Sun, 1=Mon if needed, let's safely modulo and handle both cases
      // Try to map to 0=Mon, ..., 6=Sun
      if (dayOfWeek === 0) dayIdx = 6; // If 0 is Sunday, shift it to 6
      else dayIdx = dayOfWeek - 1; // If 1 is Monday, shift to 0

      if (dayIdx < 0 || dayIdx > 6) dayIdx = 0; // fallback

      // Map hour (0-23) to bucket.
      // 8,9 -> 0
      // 10,11 -> 1
      // ...
      // 6,7 -> 11
      const hourOfDay = Number(item.hour_of_day);
      const normalizedHour = (hourOfDay - 8 + 24) % 24;
      const bucketIdx = Math.floor(normalizedHour / 2);

      if (dayIdx >= 0 && dayIdx < 7 && bucketIdx >= 0 && bucketIdx < 12) {
        buckets[dayIdx][bucketIdx] += item.email_count;
        bucketTotals[bucketIdx] += item.email_count;
      }
    });

    maxCount = Math.max(1, ...buckets.flat());
  }

  // Find optimal focus time (lowest traffic)
  let bestBucketIdx = 0;
  let minTraffic = Infinity;
  bucketTotals.forEach((total, idx) => {
    // Exclude night hours from "optimal focus time" if desired, assuming working hours 08:00 - 18:00 (buckets 0 to 4)
    if (idx <= 4 && total < minTraffic) {
      minTraffic = total;
      bestBucketIdx = idx;
    }
  });

  const bestStartTime = (8 + bestBucketIdx * 2) % 24;
  const bestEndTime = (bestStartTime + 2) % 24;
  const formatHour = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr} ${ampm}`;
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Inbox Traffic Heatmap</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Hourly arrival density for the last 7 days</p>
        </div>
        <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-4 py-2 rounded-xl text-sm font-medium">
          <Lightbulb className="w-4 h-4" />
          Best focus: {formatHour(bestStartTime)}-{formatHour(bestEndTime)}
        </div>
      </div>

      <div className="flex">
        {/* Y Axis Labels */}
        <div className="flex flex-col gap-2 pr-4 mt-8">
          {DAYS.slice(0, 5).map(day => ( // Only showing Mon-Fri as per the image. Remove .slice to show weekend
            <div key={day} className="h-8 flex items-center text-xs font-medium text-neutral-500 w-8">
              {day}
            </div>
          ))}
        </div>

        {/* Heatmap Grid */}
        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[600px]">
            {/* X Axis Labels */}
            <div className="flex mb-2">
              {HOURS.map(hour => (
                <div key={hour} className="flex-1 text-center text-xs text-neutral-500">
                  {hour}
                </div>
              ))}
            </div>

            {/* Grid Cells */}
            <div className="flex flex-col gap-2">
              {buckets.slice(0, 5).map((row, dayIdx) => (
                <div key={dayIdx} className="flex gap-2">
                  {row.map((count, bucketIdx) => (
                    <div
                      key={bucketIdx}
                      className={`flex-1 h-8 rounded-md transition-colors ${getTrafficColor(count, maxCount)}`}
                      title={`${count} emails`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-6">
        <span className="text-xs text-neutral-500 font-medium mr-2">LOW</span>
        <div className="w-4 h-4 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="w-4 h-4 rounded bg-indigo-50 dark:bg-indigo-950" />
        <div className="w-4 h-4 rounded bg-indigo-200 dark:bg-indigo-800" />
        <div className="w-4 h-4 rounded bg-indigo-500 dark:bg-indigo-600" />
        <div className="w-4 h-4 rounded bg-indigo-700 dark:bg-indigo-500" />
        <span className="text-xs text-neutral-500 font-medium ml-2">HIGH</span>
      </div>
    </div>
  );
};

export default HeatMap;