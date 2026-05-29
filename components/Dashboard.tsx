"use client";

import { useGetUserMailsThisMonth } from "@/features/stats/use-get-mail-thisMonth";
import { useUser } from "@clerk/nextjs";
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

  const { data, isLoading } = useGetUserMailsThisMonth(from, to);

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
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {greeting.text}, {user?.firstName || "User"}
          </h1>
          <p className="text-muted-foreground">{greeting.subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <DatePickerWithRange date={date} setDate={setDate} />
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Emails Received */}
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Emails received
          </p>
          <p className="text-2xl font-semibold text-card-foreground mt-1">
            {isLoading ? "..." : data?.current ?? 0}
          </p>
        </div>

        {/* Unread */}
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Unread
          </p>
          <p className="text-2xl font-semibold text-card-foreground mt-1">
            {isLoading ? "..." : data?.unreadCount ?? 0}
          </p>
        </div>

        {/* Avg Emails per Day */}
        <div className="bg-card rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Avg emails per day
          </p>
          <p className="text-2xl font-semibold text-card-foreground mt-1">
            {isLoading ? "..." : Math.ceil((data?.current ?? 0) / totalDays)}
          </p>
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
