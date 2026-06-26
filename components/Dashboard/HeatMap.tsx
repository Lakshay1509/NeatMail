'use client';

import { useGetTrafficHeatmap } from "@/features/stats/use-get-traffic-heatmap";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb } from "lucide-react";

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOURS = [
  '08:00', '10:00', '12:00', '14:00', '16:00', '18:00',
  '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'
];

const HeatMap = ({ from, to }: { from?: string; to?: string }) => {
  const { data, isLoading, isError } = useGetTrafficHeatmap(from, to);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-6 h-80">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (isError) {
    return <div className="bg-card rounded-lg border p-6 text-muted-foreground">Failed to load heatmap data.</div>;
  }

  // Group data by day (1-7, assuming Monday is 1, or 0-6). Let's assume 0=Monday to 6=Sunday for mapping or adapt based on JS getDay (0=Sun). 
  // We'll normalize to 0=MON, 6=SUN.
  const getTrafficColor = (count: number, maxCount: number) => {
    if (count === 0) return 'bg-[#e8f5f1] dark:bg-[#1b2f2a]';
    const ratio = count / maxCount;
    if (ratio < 0.25) return 'bg-[#bfe8d8] dark:bg-[#245145]';
    if (ratio < 0.5) return 'bg-[#5dc8a8] dark:bg-[#2f8a74]';
    if (ratio < 0.75) return 'bg-[#1ea97f] dark:bg-[#1f7f63]';
    return 'bg-[#0c5c49] dark:bg-[#2ab08a]';
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
    <div className="bg-card rounded-lg border p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
          Inbox Traffic
        </p>
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
          <Lightbulb className="w-3.5 h-3.5" />
          Best focus window: {formatHour(bestStartTime)}–{formatHour(bestEndTime)}
        </div>
      </div>

      <div className="flex">
        {/* Y Axis Labels */}
        <div className="flex flex-col gap-2 pr-4 mt-8">
          {DAYS.slice(0, 5).map(day => ( // Only showing Mon-Fri as per the image. Remove .slice to show weekend
            <div key={day} className="h-8 flex items-center text-xs font-medium text-muted-foreground w-8">
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
                <div key={hour} className="flex-1 text-center text-xs text-muted-foreground">
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
        <span className="text-xs text-muted-foreground font-medium mr-2">LOW</span>
        <div className="w-4 h-4 rounded bg-[#e8f5f1] dark:bg-[#1b2f2a]" />
        <div className="w-4 h-4 rounded bg-[#bfe8d8] dark:bg-[#245145]" />
        <div className="w-4 h-4 rounded bg-[#5dc8a8] dark:bg-[#2f8a74]" />
        <div className="w-4 h-4 rounded bg-[#1ea97f] dark:bg-[#1f7f63]" />
        <div className="w-4 h-4 rounded bg-[#0c5c49] dark:bg-[#2ab08a]" />
        <span className="text-xs text-muted-foreground font-medium ml-2">HIGH</span>
      </div>
    </div>
  );
};

export default HeatMap;