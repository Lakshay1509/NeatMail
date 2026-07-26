import { clerkClient } from "@clerk/nextjs/server";

// Bounded future window used to resolve event-anchored deadlines ("before the
// sprint review") that carry no literal date. Wide enough to catch a named
// event a few weeks out, capped so a busy calendar doesn't blow up the prompt.
const EVENT_LOOKUP_WINDOW_DAYS = 60;
const EVENT_LOOKUP_MAX_RESULTS = 40;

export interface CalendarEventLite {
  title: string;
  /** ISO 8601 start instant. */
  start: string;
  attendees?: string[];
}

/**
 * Upcoming Google Calendar events for `userId` in [anchor, anchor + window].
 * Independent OAuth token fetch (mirrors context-engine/providers/google-calender.ts)
 * since getGmailClient only exposes a wrapped client, not the raw token. Never
 * throws — callers treat an empty array the same as "no calendar connected".
 */
export async function fetchUpcomingGoogleEvents(
  userId: string,
  anchor: Date,
): Promise<CalendarEventLite[]> {
  try {
    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(
      userId,
      "google",
    );
    const token = tokenResponse.data[0]?.token;
    if (!token) return [];

    const timeMin = anchor.toISOString();
    const timeMax = new Date(
      anchor.getTime() + EVENT_LOOKUP_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(EVENT_LOOKUP_MAX_RESULTS));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = json.items ?? [];

    return items
      .map((event): CalendarEventLite | null => {
        const title = typeof event.summary === "string" ? event.summary : "";
        const start = event.start as Record<string, string> | undefined;
        const startVal = start?.dateTime ?? start?.date;
        if (!title || !startVal) return null;
        const attendeesRaw = Array.isArray(event.attendees)
          ? (event.attendees as Array<Record<string, unknown>>)
          : [];
        const attendees = attendeesRaw
          .map((a) => (typeof a.email === "string" ? a.email : null))
          .filter((e): e is string => !!e);
        return {
          title,
          start: startVal,
          attendees: attendees.length ? attendees : undefined,
        };
      })
      .filter((e): e is CalendarEventLite => e !== null);
  } catch (err) {
    console.error(
      "[promise-calendar] fetchUpcomingGoogleEvents failed:",
      err,
    );
    return [];
  }
}

/**
 * Outbound counterpart of {@link fetchUpcomingGoogleEvents} for Outlook/Graph.
 * `calendarView` doesn't reliably support $orderby (unsupported/flaky on that
 * resource per Graph docs — safe on /events, not on calendarView), so results
 * are sorted client-side by start time instead of relying on server order.
 */
export async function fetchUpcomingOutlookEvents(
  userId: string,
  anchor: Date,
): Promise<CalendarEventLite[]> {
  try {
    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(
      userId,
      "microsoft",
    );
    const token = tokenResponse.data[0]?.token;
    if (!token) return [];

    const startDateTime = anchor.toISOString();
    const endDateTime = new Date(
      anchor.getTime() + EVENT_LOOKUP_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    url.searchParams.set("startDateTime", startDateTime);
    url.searchParams.set("endDateTime", endDateTime);
    url.searchParams.set("$top", String(EVENT_LOOKUP_MAX_RESULTS));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      value?: Array<Record<string, unknown>>;
    };
    const items = json.value ?? [];

    const events = items
      .map((event): CalendarEventLite | null => {
        const title = typeof event.subject === "string" ? event.subject : "";
        const start = event.start as Record<string, string> | undefined;
        const startVal = start?.dateTime;
        if (!title || !startVal) return null;
        const attendeesRaw = Array.isArray(event.attendees)
          ? (event.attendees as Array<Record<string, unknown>>)
          : [];
        const attendees = attendeesRaw
          .map((a) => {
            const ea = a.emailAddress as Record<string, string> | undefined;
            return ea?.address ?? null;
          })
          .filter((e): e is string => !!e);
        // Graph returns start.dateTime without a trailing "Z" — treat as UTC
        // (the same assumption context-engine/providers/outlook-calender.ts makes).
        const normalizedStart = /[zZ]|[+-]\d{2}:\d{2}$/.test(startVal)
          ? startVal
          : `${startVal}Z`;
        return {
          title,
          start: normalizedStart,
          attendees: attendees.length ? attendees : undefined,
        };
      })
      .filter((e): e is CalendarEventLite => e !== null);

    events.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    return events;
  } catch (err) {
    console.error(
      "[promise-calendar] fetchUpcomingOutlookEvents failed:",
      err,
    );
    return [];
  }
}
