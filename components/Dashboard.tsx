"use client";

import { useGetUserMailsThisMonth } from "@/features/stats/use-get-mail-thisMonth";
import { useUser } from "@clerk/nextjs";
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { differenceInDays, subDays } from "date-fns";
import { DatePickerWithRange } from "./DatePickerWithRange";
import { LabelDistribution } from "./LabelDistribution";
import Clutter from "./Dashboard/Clutter";
import HeatMap from "./Dashboard/HeatMap";
import MostEmails from "./Dashboard/MostEmails";
import ReadVsUnread from "./Dashboard/ReadVsUnread";

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

  const { data, isLoading, isError } = useGetUserMailsThisMonth(from, to);

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

  const renderTrend = (percentChange: number | null | undefined) => {
    if (percentChange === undefined || percentChange === null) return null;
    if (percentChange === 0) {
      return (
        <div className="flex items-center text-xs text-gray-500 mt-2">
          <MinusIcon className="w-3 h-3 mr-1" />
          <span>Same as last week</span>
        </div>
      );
    }
    const isPositive = percentChange > 0;
    const Icon = isPositive ? ArrowUpIcon : ArrowDownIcon;
    // Reversed colors since less labeled emails / time is generally "less", but maybe "more time saved" is good?
    // Let's stick to standard: up = green, down = red.
    const colorClass = isPositive
      ? "text-emerald-700 bg-emerald-50"
      : "text-rose-700 bg-rose-50";

    return (
      <div className="flex items-center mt-2 group">
        <span
          className={`flex items-center px-1.5 py-0.5 rounded-md text-xs font-semibold ${colorClass}`}
        >
          <Icon className="w-3 h-3 mr-1" />
          {Math.abs(percentChange)}%
        </span>
        <span className="text-xs font-medium text-gray-500 ml-2">
          vs last week
        </span>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {greeting.text}, {user?.firstName || "User"}
          </h1>
          <p className="text-gray-500">{greeting.subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <DatePickerWithRange date={date} setDate={setDate} />
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1 */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 relative overflow-hidden flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
              Emails Received
            </p>
            <div className="w-full flex justify-between items-center">
              <p className="text-2xl font-semibold text-gray-900 mt-1">
                {isLoading ? "..." : data?.current || 0}
              </p>
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
              Unread
            </p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">
              {/* {(() => {
                const seconds = (data?.current ?? 0) * 5;

                if (seconds < 60) return `${seconds} seconds`;
                if (seconds < 3600)
                  return `${(seconds / 60).toFixed(1)} minutes`;
                return `${(seconds / 3600).toFixed(1)} hours`;
              })()} */}
              {data?.unreadCount}
            </p>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
              Avg emails / day
            </p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">
              {Math.ceil((data?.current ?? 0) / totalDays)}
            </p>
          </div>
        </div>
      </div>

      {/* Charts & Distribution Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <LabelDistribution from={from} to={to} />
        </div>
        <div className="lg:col-span-1">
          <Clutter from={from} to={to} />
        </div>
        <div className="lg:col-span-1">
          <MostEmails from={from} to={to} />
        </div>
        <div className="lg:col-span-3">
          <ReadVsUnread from={from} to={to} />
        </div>
      </div>

      <HeatMap from={from} to={to} />
    </div>
  );
};

export default Dashboard;
