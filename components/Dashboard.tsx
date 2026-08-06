"use client";

import { useGetOverview } from "@/features/stats/use-get-overview";
import { useGetUserTagsWeek } from "@/features/stats/use-get-user-tagsThisWeek";
import { useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
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
import { StatCard, type StatTrend } from "./Dashboard/StatCard";
import FirstRunSweepBanner from "./FirstRunSweepBanner";

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
  // No "vs prev" suffix — the arrow already says it, and the label sits inline
  // with the value where the extra words don't fit on a narrow card.
  return {
    label: `${rounded > 0 ? "+" : ""}${rounded}%`,
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
    label: `${diff > 0 ? "+" : ""}${diff} pts`,
    good: diff > 0,
    direction: diff > 0 ? "up" : "down",
  };
}

const Dashboard = ({
  // Whether any mail in the picker's default range carries an AI label,
  // resolved on the server (see app/page.tsx) so the first paint doesn't have
  // to guess how many cards each chart row holds.
  initialHasLabels,
}: {
  initialHasLabels?: boolean;
}) => {
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

  // The two label-based cards (Unread Breakdown + Label Distribution) are hidden
  // entirely when there's no AI label data yet, instead of showing an empty
  // state. Shares its query key with <LabelDistribution/>, so React Query dedupes
  // the call.
  const {
    data: labelTags,
    isSuccess: labelsSuccess,
    isError: labelsError,
  } = useGetUserTagsWeek(from, to);

  // Whether the label cards belong on screen decides the column count of the two
  // rows below, so every card in those rows changes width when it flips. The
  // server already answered it for the default range, which is what the first
  // paint renders, so there's no guessing window: a new user gets the narrow
  // layout immediately and never sees a placeholder for a card that won't
  // arrive. Once the query resolves it owns the answer, since it tracks the
  // range the user actually picked. `null` — nothing known — is only reachable
  // if `initialHasLabels` was omitted.
  const hasLabels = labelsSuccess
    ? (labelTags?.length ?? 0) > 0
    : labelsError
      ? false
      : (initialHasLabels ?? null);

  // Only with the prop omitted, then. Siblings hold their skeletons until the
  // count is known rather than mounting at a width they're about to lose: a grey
  // block resizing is cheap, a mounted Recharts canvas being re-measured from
  // half to full width is the flicker.
  const layoutPending = hasLabels === null;
  const showLabelCards = hasLabels !== false;

  const current = overview?.current ?? 0;
  const avgPerDay = Math.ceil(current / totalDays);
  const prevAvgPerDay = Math.ceil((overview?.previous ?? 0) / totalDays);

  // Time- and random-based, so it must be computed on the client only.
  // Running it during SSR would produce a different value than the client's
  // first render (random subtitle + server-UTC vs client-local hour) and
  // trigger a hydration mismatch.
  const [greeting, setGreeting] = useState<{
    text: string;
    subtitle: string;
  } | null>(null);

  useEffect(() => {
    const hour = new Date().getHours();
    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    if (hour < 12)
      setGreeting({ text: "Good Morning", subtitle: pick(subtitles.morning) });
    else if (hour < 18)
      setGreeting({
        text: "Good Afternoon",
        subtitle: pick(subtitles.afternoon),
      });
    else
      setGreeting({ text: "Good Evening", subtitle: pick(subtitles.evening) });
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-5 md:space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {greeting ? `${greeting.text}, ` : ""}
            {user?.firstName || "User"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {greeting?.subtitle ?? " "}
          </p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto min-w-0">
          <DatePickerWithRange date={date} setDate={setDate} />
        </div>
      </div>

      {/* First-run "Kaboom" sweep — one-tap inbox clear-out for new users.
          Self-gates: renders nothing once swept, or for Outlook users. */}
      <FirstRunSweepBanner />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Emails received"
          value={current}
          icon={Mail}
          trend={pctTrend(overview?.current, overview?.previous, true)}
          isLoading={isLoading}
        />
        <StatCard
          title="Read rate"
          value={`${overview?.readRate ?? 0}%`}
          icon={MailOpen}
          trend={pointsTrend(overview?.readRate, overview?.previousReadRate)}
          isLoading={isLoading}
        />
        <StatCard
          title="Unread"
          value={overview?.unread ?? 0}
          icon={MailWarning}
          trend={pctTrend(overview?.unread, overview?.previousUnread, false)}
          isLoading={isLoading}
        />
        {/* Short label so it stays on one line even in a narrow card */}
        <StatCard
          title="Avg per day"
          value={avgPerDay}
          icon={CalendarClock}
          trend={pctTrend(avgPerDay, prevAvgPerDay, true)}
          isLoading={isLoading}
        />
      </div>

       

      {/* Status + Trend */}
      <div
        className={`grid grid-cols-1 gap-3 ${
          showLabelCards ? "lg:grid-cols-2" : ""
        }`}
      >
        {showLabelCards && (
          <EmailStatusBreakdown from={from} to={to} pending={layoutPending} />
        )}
        <ReadVsUnread from={from} to={to} pending={layoutPending} />
      </div>

      {/* Senders & Labels */}
      <div
        className={`grid grid-cols-1 gap-3 ${
          showLabelCards ? "lg:grid-cols-3" : "lg:grid-cols-2"
        }`}
      >
        <MostEmails from={from} to={to} pending={layoutPending} />
        <Clutter from={from} to={to} pending={layoutPending} />
        {showLabelCards && (
          <LabelDistribution from={from} to={to} pending={layoutPending} />
        )}
      </div>

     

      {/* Inbox Traffic Heatmap */}
      <HeatMap from={from} to={to} />
    </div>
  );
};

export default Dashboard;
