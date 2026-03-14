// src/context-engine/providers/google-calendar.ts

import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

export class GoogleCalendarProvider implements ContextProvider {
  id   = "google-calendar"
  name = "Google Calendar"

  // Only runs on emails that mention dates — skipped for everything else
  relevantIntents: EmailIntent[] = ["scheduling_request", "follow_up"]

  async fetchContext(
    _email:   IncomingEmail,
    entities: EmailEntities,
    userId:   string
  ): Promise<ContextCard | null> {

    // No dates mentioned in email — nothing for Calendar to contribute
    if (entities.mentionedDates.length === 0) return null

    // Get token from Clerk — same as your working calendar.ts
    let token: string
    try {

      const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(
      userId,
      "google",
    );

    token = tokenResponse.data[0]?.token;
    } catch {
      return null   // User hasn't connected Google — skip gracefully
    }

    // Check availability for each mentioned date (your existing logic)
    const results = await Promise.all(
      entities.mentionedDates.slice(0, 3).map(d => this.checkSlot(d, token))
    )

    const summaryLines = results.map(r => {
      const status = r.isFree ? "✅ FREE" : "BUSY"
      const conflict = r.busySlots[0]
        ? ` — conflicts with event from ${r.busySlots[0].start} to ${r.busySlots[0].end}`
        : ""
      return `- ${r.raw} → ${status}${conflict}. ${r.eventCount} total events that day.`
    })

    console.log(summaryLines);

    return {
      providerId:   this.id,
      providerName: this.name,
      relevance:    "high",
      summary:      `User's availability:\n${summaryLines.join("\n")}`,
      data:         results,
    }
  }

  // ── Private — your exact logic from calendar.ts ───────────

  private async checkSlot(
    date:  { raw: string; iso: string },
    token: string
  ) {
    const start = new Date(date.iso)
    const end   = new Date(start.getTime() + 60 * 60 * 1000)

    // Extract the timezone offset from the ISO string (e.g. "+05:30" or "Z")
    // so that day-boundary queries stay in the user's local timezone, not UTC.
    // Without this, an IST event at 10 AM on Mon maps to Sunday UTC — returning 0 events.
    const tzOffsetMatch = date.iso.match(/([+-]\d{2}:\d{2}|Z)$/)
    const tzOffset      = tzOffsetMatch ? tzOffsetMatch[1] : "Z"
    const isoDate       = date.iso.split("T")[0]
    const dayStart      = `${isoDate}T00:00:00${tzOffset}`
    const dayEnd        = `${isoDate}T23:59:59${tzOffset}`

    const [freeBusyRes, eventsRes] = await Promise.all([
      fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          items:   [{ id: "primary" }],
        }),
      }),
      fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${dayStart}&timeMax=${dayEnd}&singleEvents=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
    ])

    const freeBusy = await freeBusyRes.json()
    const events   = await eventsRes.json()

    return {
      raw:        date.raw,
      iso:        date.iso,
      isFree:     (freeBusy.calendars?.primary?.busy ?? []).length === 0,
      busySlots:  freeBusy.calendars?.primary?.busy ?? [],
      eventCount: (events.items ?? []).length,
    }
  }
}