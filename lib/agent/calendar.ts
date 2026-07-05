// Net-new: free-slot ENUMERATION for calendar-aware replies.
//
// The existing context-engine calendar providers only VALIDATE specific dates
// parsed from an incoming email ("is 3pm Tuesday free?"). To let the agent
// proactively OFFER times, we need the inverse: given a window, return the
// user's actually-free working-hour slots. One freeBusy/getSchedule call per
// provider gives the busy blocks; we subtract them from candidate slots.

import { fromZonedTime } from "date-fns-tz/fromZonedTime";
import { clerkClient } from "@clerk/nextjs/server";

export interface FreeSlot {
  startIso: string;
  endIso: string;
  /** Human-readable, formatted in the user's timezone (for the draft body). */
  label: string;
}

interface BusyBlock {
  start: number;
  end: number;
}

const SLOT_MINUTES = 60;

function ymdInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(date);
}

function labelSlot(startUtc: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(startUtc);
}

async function googleBusy(
  token: string,
  startUtc: Date,
  endUtc: Date,
): Promise<BusyBlock[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startUtc.toISOString(),
      timeMax: endUtc.toISOString(),
      timeZone: "UTC",
      items: [{ id: "primary" }],
    }),
  });
  const json = await res.json();
  const busy = (json.calendars?.primary?.busy ?? []) as {
    start: string;
    end: string;
  }[];
  return busy.map((b) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  }));
}

async function outlookBusy(
  token: string,
  email: string,
  startUtc: Date,
  endUtc: Date,
): Promise<BusyBlock[]> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schedules: [email],
        startTime: { dateTime: startUtc.toISOString(), timeZone: "UTC" },
        endTime: { dateTime: endUtc.toISOString(), timeZone: "UTC" },
        availabilityViewInterval: 60,
      }),
    },
  );
  const json = (await res.json()) as {
    value?: {
      scheduleItems?: {
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }[];
    }[];
  };
  const items = json.value?.[0]?.scheduleItems ?? [];
  // getSchedule returns naive datetimes in the requested timeZone (UTC here);
  // append Z so Date.parse treats them as UTC.
  const asUtc = (dt?: string): number => {
    if (!dt) return NaN;
    return Date.parse(dt.endsWith("Z") ? dt : `${dt}Z`);
  };
  return items
    .map((it) => ({
      start: asUtc(it.start?.dateTime),
      end: asUtc(it.end?.dateTime),
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}

/**
 * Return the user's free working-hour slots over the next `days`. Weekdays only,
 * `workStartHour`–`workEndHour` in the user's timezone, SLOT_MINUTES long,
 * skipping anything in the past or overlapping a busy block. Empty array on any
 * auth/API failure (the caller tells the user it couldn't read the calendar).
 */
export async function getFreeSlots(opts: {
  userId: string;
  isGmail: boolean;
  timezone: string;
  days?: number;
  maxSlots?: number;
  workStartHour?: number;
  workEndHour?: number;
}): Promise<FreeSlot[]> {
  const {
    userId,
    isGmail,
    timezone,
    days = 7,
    maxSlots = 6,
    workStartHour = 9,
    workEndHour = 17,
  } = opts;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + days * 86400000);

  let busy: BusyBlock[] = [];
  try {
    const clerk = await clerkClient();
    if (isGmail) {
      const tokenRes = await clerk.users.getUserOauthAccessToken(userId, "google");
      const token = tokenRes.data[0]?.token;
      if (!token) return [];
      busy = await googleBusy(token, now, windowEnd);
    } else {
      const user = await clerk.users.getUser(userId);
      const email =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses[0]?.emailAddress;
      const tokenRes = await clerk.users.getUserOauthAccessToken(
        userId,
        "microsoft",
      );
      const token = tokenRes.data[0]?.token;
      if (!token || !email) return [];
      busy = await outlookBusy(token, email, now, windowEnd);
    }
  } catch (err) {
    console.error("[calendar] getFreeSlots failed", err);
    return [];
  }

  const overlapsBusy = (s: number, e: number) =>
    busy.some((b) => s < b.end && e > b.start);

  const slots: FreeSlot[] = [];
  for (let d = 0; d < days && slots.length < maxSlots; d++) {
    const dayDate = new Date(now.getTime() + d * 86400000);
    const wd = weekdayInTz(dayDate, timezone);
    if (wd === "Sat" || wd === "Sun") continue;
    const ymd = ymdInTz(dayDate, timezone);

    for (let h = workStartHour; h < workEndHour && slots.length < maxSlots; h++) {
      const startUtc = fromZonedTime(
        `${ymd}T${String(h).padStart(2, "0")}:00:00`,
        timezone,
      );
      const startMs = startUtc.getTime();
      const endMs = startMs + SLOT_MINUTES * 60000;
      if (startMs < now.getTime()) continue;
      if (endMs > windowEnd.getTime()) continue;
      if (overlapsBusy(startMs, endMs)) continue;

      slots.push({
        startIso: startUtc.toISOString(),
        endIso: new Date(endMs).toISOString(),
        label: labelSlot(startUtc, timezone),
      });
    }
  }

  return slots;
}
