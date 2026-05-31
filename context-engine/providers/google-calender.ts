// src/context-engine/providers/google-calendar.ts

import { fromZonedTime } from "date-fns-tz/fromZonedTime"
import { getTimezoneOffset } from "date-fns-tz/getTimezoneOffset"
import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const TAG = "[GoogleCalendar]"

export class GoogleCalendarProvider implements ContextProvider {
  id   = "google-calendar"
  name = "Google Calendar"

  relevantIntents: EmailIntent[] = ["scheduling_request", "follow_up"]

  async fetchContext(
    _email:   IncomingEmail,
    entities: EmailEntities,
    userId:   string
  ): Promise<ContextCard | null> {

    if (entities.mentionedDates.length === 0) {
      console.log(`${TAG} No mentioned dates — skipping`)
      return null
    }

    console.log(
      `${TAG} fetchContext called — ${entities.mentionedDates.length} dates, timezone="${entities.timezone}", intent="${entities.intent}"`
    )
    entities.mentionedDates.forEach((d, i) =>
      console.log(`${TAG}   date[${i}]: raw="${d.raw}"  iso="${d.iso}"`)
    )

    let token: string
    try {
      const client = await clerkClient()
      const tokenResponse = await client.users.getUserOauthAccessToken(
        userId,
        "google",
      )
      token = tokenResponse.data[0]?.token
    } catch {
      console.log(`${TAG} No Google OAuth token — skipping`)
      return null
    }

    const timezone = entities.timezone

    const results = await Promise.all(
      entities.mentionedDates.slice(0, 3).map(d => this.checkSlot(d, token, timezone))
    )

    console.log(`${TAG} checkSlot results:`)
    results.forEach(r => {
      console.log(`${TAG}   "${r.raw}" → isFree=${r.isFree}  busySlots=${r.busySlots.length}  eventCount=${r.eventCount}`)
    })

    const summaryLines = results.map(r => {
      const status = r.isFree ? "FREE" : "*** BUSY ***"
      const conflict = r.busySlots.length
        ? ` busy: ${r.busySlots
            .map((slot: { start: string; end: string }) => `${slot.start} to ${slot.end}`)
            .join(", ")}`
        : ""
      return `- ${r.raw} → ${status}${conflict}. ${r.eventCount} events.`
    })

    const summary = `User's availability:\n${summaryLines.join("\n")}`
    console.log(`${TAG} Context summary → LLM:`)
    console.log(summary)

    return {
      providerId:   this.id,
      providerName: this.name,
      relevance:    "high",
      summary,
      data:         results,
    }
  }

  private async checkSlot(
    date:     { raw: string; iso: string },
    token:    string,
    timezone: string
  ) {
    console.log(`${TAG} checkSlot("${date.raw}")  iso="${date.iso}"  timezone="${timezone}"`)

    // The external API may return either a single instant
    // ("2026-05-31T15:00:00+05:30") or an ISO 8601 interval
    // ("2026-05-31T15:00:00+05:30/2026-05-31T16:00:00+05:30").
    const isInterval = date.iso.includes("/")
    const isoStart = isInterval ? date.iso.split("/")[0] : date.iso
    const isoEnd   = isInterval ? date.iso.split("/")[1] : null

    if (isInterval) {
      console.log(`${TAG}   detected ISO interval; start="${isoStart}" end="${isoEnd}"`)
    }

    const dateOnly = isoStart.split("T")[0]
    const timePart = isoStart.split("T")[1]?.split(/[-+Z]/)[0] ?? "00:00:00"

    const isoOffsetMs = this.extractOffsetMs(isoStart)
    const expectedOffsetMs = getTimezoneOffset(timezone, new Date(`${dateOnly}T12:00:00Z`))

    console.log(
      `${TAG}   offset check: iso=${isoOffsetMs}ms (${this.fmtOffsetMs(isoOffsetMs)})  expected=${expectedOffsetMs}ms (${this.fmtOffsetMs(expectedOffsetMs)})`
    )

    let slotStart: Date
    if (isoOffsetMs !== expectedOffsetMs) {
      slotStart = fromZonedTime(`${dateOnly}T${timePart}`, timezone)
      console.log(
        `${TAG}   *** MISMATCH — reinterpreted "${dateOnly}T${timePart}" as ${timezone} → slotStart=${slotStart.toISOString()}`
      )
    } else {
      slotStart = new Date(isoStart)
      console.log(
        `${TAG}   offset match — using as-is → slotStart=${slotStart.toISOString()}`
      )
    }

    // Use the end time from the interval when available, otherwise
    // default to 1 hour after start.
    let slotEnd: Date
    const needsReinterpret = isoOffsetMs !== expectedOffsetMs
    if (isoEnd && needsReinterpret) {
      const endDateOnly = isoEnd.split("T")[0]
      const endTimePart = isoEnd.split("T")[1]?.split(/[-+Z]/)[0] ?? "00:00:00"
      slotEnd = fromZonedTime(`${endDateOnly}T${endTimePart}`, timezone)
      console.log(
        `${TAG}   reinterpreted interval end too → slotEnd=${slotEnd.toISOString()}`
      )
    } else if (isoEnd) {
      slotEnd = new Date(isoEnd)
      console.log(
        `${TAG}   using interval end as-is → slotEnd=${slotEnd.toISOString()}`
      )
    } else {
      slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000)
    }

    const fbStart = new Date(slotStart.getTime() - 15 * 60 * 1000)
    const fbEnd   = new Date(slotEnd.getTime()   + 15 * 60 * 1000)

    console.log(
      `${TAG}   slot window (local): ${slotStart.toISOString()} → ${slotEnd.toISOString()}`
    )
    console.log(
      `${TAG}   freeBusy window (+/-15m): ${fbStart.toISOString()} → ${fbEnd.toISOString()}`
    )

    const dayStartUtc = fromZonedTime(`${dateOnly}T00:00:00`, timezone)
    const dayEndUtc   = fromZonedTime(`${dateOnly}T23:59:59`, timezone)
    console.log(
      `${TAG}   day boundaries (in ${timezone}): ${dayStartUtc.toISOString()} → ${dayEndUtc.toISOString()}`
    )

    const eventsUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events")
    eventsUrl.searchParams.set("timeMin",      dayStartUtc.toISOString())
    eventsUrl.searchParams.set("timeMax",      dayEndUtc.toISOString())
    eventsUrl.searchParams.set("singleEvents", "true")

    const [freeBusyRes, eventsRes] = await Promise.all([
      fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin:  fbStart.toISOString(),
          timeMax:  fbEnd.toISOString(),
          timeZone: "UTC",
          items:    [{ id: "primary" }],
        }),
      }),
      fetch(
        eventsUrl.toString(),
        { headers: { Authorization: `Bearer ${token}` } }
      )
    ])

    const freeBusy = await freeBusyRes.json()
    const events   = await eventsRes.json()

    const busySlots  = freeBusy.calendars?.primary?.busy ?? []
    const eventItems = (events.items ?? []) as Array<Record<string, unknown>>

    console.log(
      `${TAG}   freeBusy response: ${busySlots.length} busy slot(s)`
    )
    if (busySlots.length > 0) {
      busySlots.forEach((s: { start: string; end: string }, i: number) =>
        console.log(`${TAG}     busy[${i}]: ${s.start} → ${s.end}`)
      )
    }
    console.log(
      `${TAG}   events.list response: ${eventItems.length} event(s) on this day`
    )
    if (eventItems.length > 0) {
      eventItems.forEach((e: Record<string, unknown>, i: number) => {
        const s = e.start as Record<string, string> | undefined
        const en = e.end as Record<string, string> | undefined
        const summary = (e.summary as string) ?? "?"
        const dt = s?.dateTime ?? s?.date ?? "?"
        console.log(`${TAG}     event[${i}]: "${summary}" @ ${dt}`)
      })
    }

    const slotStartMs = slotStart.getTime()
    const slotEndMs   = slotEnd.getTime()

    const overlappingEvents = eventItems.filter((event: Record<string, unknown>) => {
      const start = event.start as Record<string, string> | undefined
      const end   = event.end   as Record<string, string> | undefined
      if (!start?.dateTime || !end?.dateTime) return false

      const eventStart = new Date(start.dateTime).getTime()
      const eventEnd   = new Date(end.dateTime).getTime()
      return eventStart < slotEndMs && eventEnd > slotStartMs
    })

    const isFreeFromFreeBusy = busySlots.length === 0
    const isFreeFromEvents   = overlappingEvents.length === 0

    console.log(
      `${TAG}   overlap check: freeBusy=${isFreeFromFreeBusy ? "free" : "busy"}  events=${isFreeFromEvents ? "free" : `${overlappingEvents.length} overlapping`}`
    )

    if (!isFreeFromFreeBusy && isFreeFromEvents) {
      console.log(
        `${TAG}   ⚠ FreeBusy says busy but events.list disagrees — trusting FreeBusy.`
      )
    } else if (isFreeFromFreeBusy && !isFreeFromEvents) {
      console.log(
        `${TAG}   ⚠ FreeBusy says free but events.list found ${overlappingEvents.length} overlapping event(s) — OVERRIDING to BUSY.`
      )
      overlappingEvents.forEach((e: Record<string, unknown>, i: number) => {
        const s = e.start as Record<string, string> | undefined
        const en = e.end as Record<string, string> | undefined
        console.log(`${TAG}     overlapping[${i}]: "${e.summary}" ${s?.dateTime} → ${en?.dateTime}`)
      })
    }

    const isFree = isFreeFromFreeBusy && isFreeFromEvents
    console.log(`${TAG}   => FINAL: ${isFree ? "FREE" : "BUSY"}`)

    return {
      raw:        date.raw,
      iso:        date.iso,
      isFree,
      busySlots:  isFree ? [] : busySlots,
      eventCount: eventItems.length,
    }
  }

  private extractOffsetMs(iso: string): number {
    const m = iso.match(/([+-]\d{2}:\d{2}|Z)$/)
    if (!m || m[1] === "Z") return 0
    const [h, min] = m[1].split(":")
    return (Number(h) * 60 + Number(min)) * 60 * 1000
  }

  private fmtOffsetMs(ms: number): string {
    const sign = ms >= 0 ? "+" : "-"
    const abs = Math.abs(ms)
    const h = Math.floor(abs / 3600000)
    const m = Math.floor((abs % 3600000) / 60000)
    return `${sign}${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }
}
