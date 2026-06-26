"use client";

import { useGetOverview } from "@/features/stats/use-get-overview";
import { useGetReadVsUnread } from "@/features/stats/use-get-read-vs-unread";
import { useUser } from "@clerk/nextjs";
import { useMemo, useState, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { differenceInDays, subDays } from "date-fns";
import { Mail, MailOpen, MailWarning, CalendarClock } from "lucide-react";
import { DatePickerWithRange } from "./DatePickerWithRange";
import { LabelDistribution } from "./LabelDistribution";
import Clutter from "./Dashboard/Clutter";
import HeatMap from "./Dashboard/HeatMap";
import MostEmails from "./Dashboard/MostEmails";
import ReadVsUnread from "./Dashboard/ReadVsUnread";
import EmailStatusBreakdown from "./Dashboard/EmailStatusBreakdown";
import { InsightHighlights } from "./Dashboard/InsightHighlights";
import { StatCard, type StatTrend } from "./Dashboard/StatCard";

const subtitles = {
  morning: [
    "Let's see what landed overnight.",
    "Inbox check before the chaos begins.",
    "Your emails waited. Patiently.",
    "Fresh start. Mostly.",
    "Morning. Your inbox has thoughts.",
    "Let's get ahead of it today.",
    "Coffee first, clutter second.",
  ],
  afternoon: [
    "Your inbox survived the morning.",
    "Less noise, more signal.",
    "Clutter contained. Mostly.",
    "The inbox doesn't take lunch breaks. We do it for you.",
    "Keeping things neat since you opened this tab.",
    "You've got better things to do. We know.",
  ],
  evening: [
    "Wrapping up. Your inbox is under control.",
    "Almost done for the day. Your inbox already is.",
    "End of day. NeatMail kept watch.",
    "Clutter sorted. Go touch grass.",
    "Your inbox won't bother you tonight.",
    "Another day, fewer distractions.",
    "Signing off? We've got the inbox.",
  ],
};

// Percentage change vs the previous window.
function pctTrend(
  current?: number,
  previous?: number,
  positiveIsGood = true
): StatTrend | null {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0)
      return { label: "No change", good: true, direction: "flat" };
    return { label: "New activity", good: positiveIsGood, direction: "up" };
  }
  const rounded = Math.round(((current - previous) / previous) * 100);
  if (rounded === 0)
    return { label: "No change", good: true, direction: "flat" };
  const direction = rounded > 0 ? "up" : "down";
  const good = positiveIsGood ? rounded > 0 : rounded < 0;
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded}% vs prev`,
    good,
    direction,
  };
}

// Points difference for rate-style metrics.
function pointsTrend(current?: number, previous?: number): StatTrend | null {
  if (current == null || previous == null) return null;
  const diff = Number((current - previous).toFixed(1));
  if (diff === 0) return { label: "No change", good: true, direction: "flat" };
  return {
    label: `${diff > 0 ? "+" : ""}${diff} pts vs prev`,
    good: diff > 0,
    direction: diff > 0 ? "up" : "down",
  };
}

const Dashboard = () => {
  const { user } = useUser();
  const [date, setDate] = useState<DateRange | undefined>({
    from: subDays(new Date(), 14),
    to: new Date(),
  });
  const [debouncedDate, setDebouncedDate] = useState<DateRange | undefined>(date);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedDate(date);
    }, 500);
    return () => clearTimeout(handler);
  }, [date]);

  const from = debouncedDate?.from?.toISOString();
  const to = debouncedDate?.to?.toISOString();

  const totalDays =
    debouncedDate?.from && debouncedDate?.to
      ? Math.max(differenceInDays(debouncedDate.to, debouncedDate.from), 1)
      : 1;

  const { data: overview, isLoading } = useGetOverview(from, to);
  // Shares the same query key as <ReadVsUnread/>, so React Query dedupes the
  // network call; we only borrow the daily series for the KPI sparklines.
  const { data: trend } = useGetReadVsUnread(from, to);

  const series = trend?.data ?? [];
  const totalSeries = series.map((d) => d.total);
  const unreadSeries = series.map((d) => d.unread);
  const readRateSeries = series.map((d) =>
    d.total > 0 ? Number(((d.read / d.total) * 100).toFixed(1)) : 0
  );

  const current = overview?.current ?? 0;
  const avgPerDay = Math.ceil(current / totalDays);
  const prevAvgPerDay = Math.ceil((overview?.previous ?? 0) / totalDays);

  const getGreeting = () => {
    const hour = new Date().getHours();
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    if (hour < 12)
      return { text: "Good Morning", subtitle: pick(subtitles.morning) };
    if (hour < 18)
      return { text: "Good Afternoon", subtitle: pick(subtitles.afternoon) };
    return { text: "Good Evening", subtitle: pick(subtitles.evening) };
  };

  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div className="max-w-7xl mx-auto space-y-5 md:space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {greeting.text}, {user?.firstName || "User"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{greeting.subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <DatePickerWithRange date={date} setDate={setDate} />
        </div>
      </div>

      {/* Insight Highlights */}
      <InsightHighlights from={from} to={to} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Emails received"
          value={current}
          icon={Mail}
          trend={pctTrend(overview?.current, overview?.previous, true)}
          sparkline={totalSeries}
          accent="#10b981"
          isLoading={isLoading}
        />
        <StatCard
          title="Read rate"
          value={`${overview?.readRate ?? 0}%`}
          icon={MailOpen}
          trend={pointsTrend(overview?.readRate, overview?.previousReadRate)}
          sparkline={readRateSeries}
          accent="#0c5c49"
          isLoading={isLoading}
        />
        <StatCard
          title="Unread"
          value={overview?.unread ?? 0}
          icon={MailWarning}
          trend={pctTrend(overview?.unread, overview?.previousUnread, false)}
          sparkline={unreadSeries}
          accent="#3b82f6"
          isLoading={isLoading}
        />
        <StatCard
          title="Avg emails per day"
          value={avgPerDay}
          icon={CalendarClock}
          trend={pctTrend(avgPerDay, prevAvgPerDay, true)}
          sparkline={totalSeries}
          accent="#10b981"
          isLoading={isLoading}
        />
      </div>

      {/* Status + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <EmailStatusBreakdown from={from} to={to} />
        <ReadVsUnread from={from} to={to} />
      </div>

      {/* Senders & Labels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <MostEmails from={from} to={to} />
        <Clutter from={from} to={to} />
        <LabelDistribution from={from} to={to} />
      </div>

      {/* Inbox Traffic Heatmap */}
      <HeatMap from={from} to={to} />
    </div>
  );
};

export default Dashboard;
