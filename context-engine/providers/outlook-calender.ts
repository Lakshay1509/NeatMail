import { clerkClient } from "@clerk/nextjs/server"
import {
	ContextProvider,
	ContextCard,
	EmailEntities,
	EmailIntent,
	IncomingEmail,
} from "../types"

type ScheduleBusySlot = {
	start: string
	end: string
}

type OutlookSlotResult = {
	raw: string
	iso: string
	isFree: boolean
	busySlots: ScheduleBusySlot[]
	eventCount: number
}

export class OutlookCalendarProvider implements ContextProvider {
	id = "outlook-calendar"
	name = "Outlook Calendar"

	relevantIntents: EmailIntent[] = ["scheduling_request", "follow_up"]

	async fetchContext(
		_email: IncomingEmail,
		entities: EmailEntities,
		userId: string
	): Promise<ContextCard | null> {
		if (entities.mentionedDates.length === 0) return null

		let token: string
		let userEmail:string
		try {
			const client = await clerkClient()
			const user = await client.users.getUser(userId)
			userEmail = user.emailAddresses[0]?.emailAddress
			
			const tokenResponse = await client.users.getUserOauthAccessToken(
				userId,
				"microsoft"
			)

			token = tokenResponse.data[0]?.token
			if (!token) return null
		} catch {
			return null
		}

		const results = await Promise.all(
			entities.mentionedDates.slice(0, 3).map((d) => this.checkSlot(d, token,userEmail))
		)

		const summaryLines = results.map((r) => {
			const status = r.isFree ? "✅ FREE" : "BUSY"
			const conflict = r.busySlots.length
				? ` — busy slots: ${r.busySlots
					.map((slot) => `${slot.start} to ${slot.end}`)
					.join(", ")}`
				: ""

			return `- ${r.raw} → ${status}${conflict}. ${r.eventCount} total events that day.`
		})

		console.log(summaryLines)

		return {
			providerId: this.id,
			providerName: this.name,
			relevance: "high",
			summary: `User's availability:\n${summaryLines.join("\n")}`,
			data: results,
		}
	}

	private async checkSlot(
		date: { raw: string; iso: string },
		token: string,
		email:string
	): Promise<OutlookSlotResult> {
		const start = new Date(date.iso)
		const end = new Date(start.getTime() + 60 * 60 * 1000)

		const tzOffsetMatch = date.iso.match(/([+-]\d{2}:\d{2}|Z)$/)
		const tzOffset = tzOffsetMatch ? tzOffsetMatch[1] : "Z"
		const isoDate = date.iso.split("T")[0]
		const dayStart = `${isoDate}T00:00:00${tzOffset}`
		const dayEnd = `${isoDate}T23:59:59${tzOffset}`

		const calendarViewUrl = new URL(
			"https://graph.microsoft.com/v1.0/me/calendarView"
		)
		calendarViewUrl.searchParams.set("startDateTime", dayStart)
		calendarViewUrl.searchParams.set("endDateTime", dayEnd)
		calendarViewUrl.searchParams.set("$top", "100")

		const [scheduleRes, eventsRes] = await Promise.all([
			fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					schedules: [email],
					startTime: { dateTime: start.toISOString(), timeZone: "UTC" },
					endTime: { dateTime: end.toISOString(), timeZone: "UTC" },
					availabilityViewInterval: 60,
				}),
			}),
			fetch(calendarViewUrl.toString(), {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			}),
		])

		const scheduleJson = (await scheduleRes.json()) as {
			value?: Array<{
				scheduleItems?: Array<{
					start?: { dateTime?: string }
					end?: { dateTime?: string }
				}>
			}>
		}

		const eventsJson = (await eventsRes.json()) as {
			value?: Array<unknown>
		}

		const busySlots: ScheduleBusySlot[] =
			scheduleJson.value?.[0]?.scheduleItems?.map((item) => ({
				start: item.start?.dateTime ?? "",
				end: item.end?.dateTime ?? "",
			})) ?? []

		return {
			raw: date.raw,
			iso: date.iso,
			isFree: busySlots.length === 0,
			busySlots,
			eventCount: (eventsJson.value ?? []).length,
		}
	}
}
