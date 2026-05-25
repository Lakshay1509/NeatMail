import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const HUBSPOT_API = "https://api.hubapi.com"

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim()
}

function daysAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr).getTime()
    if (isNaN(d)) return ""
    const days = Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24))
    if (days < 0) return ""
    if (days === 0) return "today"
    if (days === 1) return "1 day ago"
    return `${days} days ago`
  } catch {
    return ""
  }
}

interface HubSpotContact {
  id: string
  properties: Record<string, string | null>
}

interface HubSpotCompany {
  id: string
  properties: Record<string, string | null>
}

interface HubSpotDeal {
  id: string
  properties: Record<string, string | null>
}

interface HubSpotOwner {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface HubSpotNote {
  id: string
  properties: Record<string, string | null>
}

interface HubSpotTask {
  id: string
  properties: Record<string, string | null>
}

interface HubSpotTicket {
  id: string
  properties: Record<string, string | null>
}

export class HubSpotProvider implements ContextProvider {
  id = "hubspot"
  name = "HubSpot"

  relevantIntents: EmailIntent[] = [
    "question",
    "task_assignment",
    "follow_up",
    "status_update",
    "approval",
    "complaint",
    "introduction",
    "general",
  ]

  async fetchContext(
    email: IncomingEmail,
    entities: EmailEntities,
    userId: string
  ): Promise<ContextCard | null> {
    console.log(`[HubSpot] fetchContext started user=${userId} senderEmail=${email.senderEmail} domain=${entities.senderDomain}`)

    let token: string
    try {
      const client = await clerkClient()
      const tokenResponse = await client.users.getUserOauthAccessToken(
        userId,
        "hubspot"
      )
      token = tokenResponse.data[0]?.token
      console.log(`[HubSpot] OAuth token retrieved: ${token ? "yes" : "NO"}`)
      if (!token) return null
    } catch (err) {
      console.error("[HubSpotProvider] Failed to get OAuth token:", err)
      return null
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }

    const [contacts, companies, owners] = await Promise.all([
      this.searchContacts(email.senderEmail, headers),
      this.searchCompanies(entities.senderDomain, headers),
      this.getOwners(headers),
    ])

    console.log(`[HubSpot] Primary search — contacts=${contacts.length} companies=${companies.length} owners=${owners.length}`)

    const contactId = contacts.length > 0 ? contacts[0].id : null
    const companyId = companies.length > 0 ? companies[0].id : null
    const contactCompanyId =
      contacts.length > 0 ? contacts[0].properties.associatedcompanyid : null

    const [companyDeals, contactDeals, notes, tasks, tickets] = await Promise.all([
      companyId ? this.getOpenDealsForCompany(companyId, headers) : Promise.resolve([]),
      contactId ? this.getOpenDealsForContact(contactId, headers) : Promise.resolve([]),
      contactId ? this.getNotesForContact(contactId, headers) : Promise.resolve([]),
      contactId ? this.getOpenTasksForContact(contactId, headers) : Promise.resolve([]),
      contactId ? this.getTicketsForContact(contactId, headers) : Promise.resolve([]),
    ])

    // Merge deals from company and contact, dedupe by id
    const dealMap = new Map<string, HubSpotDeal>()
    for (const d of companyDeals) dealMap.set(d.id, d)
    for (const d of contactDeals) dealMap.set(d.id, d)
    if (contactCompanyId && contactCompanyId !== companyId) {
      const extraDeals = await this.getOpenDealsForCompany(contactCompanyId, headers)
      for (const d of extraDeals) dealMap.set(d.id, d)
    }
    const deals = Array.from(dealMap.values())

    console.log(`[HubSpot] Secondary fetch — companyDeals=${companyDeals.length} contactDeals=${contactDeals.length} mergedDeals=${deals.length} notes=${notes.length} tasks=${tasks.length} tickets=${tickets.length}`)

    const ownerMap = new Map(
      owners.map((o) => [o.id, `${o.firstName} ${o.lastName}`])
    )

    const parts: string[] = []

    if (contacts.length > 0) {
      const c = contacts[0].properties
      const ownerId = c.hubspot_owner_id
      const ownerName = ownerId
        ? (ownerMap.get(ownerId) ?? "Unassigned")
        : "Unassigned"
      const name = [c.firstname, c.lastname].filter(Boolean).join(" ")

      parts.push(
        `Contact: ${name || "Unnamed"} (${c.email ?? email.senderEmail})`
      )
      if (c.jobtitle) parts.push(`Title: ${c.jobtitle}`)
      if (c.company) parts.push(`Company: ${c.company}`)
      if (c.phone) parts.push(`Phone: ${c.phone}`)
      parts.push(`Owner: ${ownerName}`)
      if (c.lifecyclestage) parts.push(`Lifecycle: ${c.lifecyclestage}`)
      if (c.hs_lead_status) parts.push(`Lead Status: ${c.hs_lead_status}`)
      if (c.hubspotscore) parts.push(`Score: ${c.hubspotscore}`)
      if (c.notes_last_contacted) {
        const ago = daysAgo(c.notes_last_contacted)
        if (ago) parts.push(`Last contacted: ${ago}`)
      }
    }

    if (companies.length > 0 && contacts.length === 0) {
      const comp = companies[0].properties
      parts.push(`Company: ${comp.name ?? entities.senderDomain}`)
      if (comp.industry) parts.push(`Industry: ${comp.industry}`)
      if (comp.description) {
        parts.push(
          `Description: ${comp.description.slice(0, 150)}${comp.description.length > 150 ? "..." : ""}`
        )
      }
    }

    if (deals.length > 0) {
      parts.push("")
      parts.push("Open deals:")
      for (const d of deals.slice(0, 3)) {
        const dp = d.properties
        const dealOwner = dp.hubspot_owner_id
          ? (ownerMap.get(dp.hubspot_owner_id) ?? "Unassigned")
          : "Unassigned"
        const amount = dp.amount
          ? `$${parseFloat(dp.amount).toLocaleString()}`
          : "—"
        const stage = dp.dealstage ?? "Unknown"
        const closeDate = dp.closedate
          ? new Date(dp.closedate).toLocaleDateString()
          : "—"
        parts.push(
          `  - ${dp.dealname ?? "Unnamed"} | ${stage} | ${amount} | Close: ${closeDate} | Owner: ${dealOwner}`
        )
      }
    }

    if (notes.length > 0) {
      parts.push("")
      parts.push("Recent activity:")
      for (const note of notes.slice(0, 2)) {
        const np = note.properties
        const body = stripHtml(np.hs_note_body ?? "").slice(0, 80)
        const date = np.hs_timestamp
          ? new Date(np.hs_timestamp).toLocaleDateString()
          : ""
        parts.push(
          `  - ${date ? `[${date}] ` : ""}${body}${body.length >= 80 ? "..." : ""}`
        )
      }
    }

    if (tasks.length > 0) {
      parts.push("")
      parts.push("Open tasks:")
      for (const task of tasks.slice(0, 2)) {
        const tp = task.properties
        const due = tp.hs_timestamp
          ? new Date(tp.hs_timestamp).toLocaleDateString()
          : "—"
        parts.push(
          `  - ${tp.hs_task_subject ?? "Unnamed"} | Due: ${due}${tp.hs_task_priority ? ` | ${tp.hs_task_priority}` : ""}`
        )
      }
    }

    if (tickets.length > 0) {
      parts.push("")
      parts.push("Support tickets:")
      for (const ticket of tickets.slice(0, 2)) {
        const t = ticket.properties
        parts.push(
          `  - ${t.subject ?? "Unnamed"}${t.hs_ticket_priority ? ` | Priority: ${t.hs_ticket_priority}` : ""}`
        )
      }
    }

    if (parts.length === 0) {
      console.log("[HubSpot] No data found, returning null")
      return null
    }

    const contactExists = contacts.length > 0
    const relevance = contactExists
      ? "high"
      : companies.length > 0
        ? "medium"
        : "low"

    const summary = `HubSpot CRM:\n${parts.join("\n")}`
    console.log(`[HubSpot] Returning card relevance=${relevance} summaryLength=${summary.length} parts=${parts.length}`)

    return {
      providerId: this.id,
      providerName: this.name,
      relevance,
      summary,
      data: { contacts, companies, deals, notes, tasks, tickets },
    }
  }

  private async searchContacts(
    email: string,
    headers: Record<string, string>
  ): Promise<HubSpotContact[]> {
    try {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          after: "0",
          filterGroups: [
            {
              filters: [
                { propertyName: "email", operator: "EQ", value: email },
              ],
            },
          ],
          limit: 3,
          properties: [
            "firstname",
            "lastname",
            "email",
            "company",
            "phone",
            "jobtitle",
            "hubspot_owner_id",
            "lifecyclestage",
            "associatedcompanyid",
            "hs_lead_status",
            "hubspotscore",
            "notes_last_contacted",
          ],
          sorts: ["createdate"],
        }),
      })
      const data = await res.json()
      return data.results ?? []
    } catch (err) {
      console.error("[HubSpotProvider] searchContacts failed:", err)
      return []
    }
  }

  private async searchCompanies(
    domain: string,
    headers: Record<string, string>
  ): Promise<HubSpotCompany[]> {
    try {
      const res = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/companies/search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            after: "0",
            filterGroups: [
              {
                filters: [
                  { propertyName: "domain", operator: "EQ", value: domain },
                ],
              },
            ],
            limit: 3,
            properties: [
              "name",
              "domain",
              "industry",
              "hubspot_owner_id",
              "description",
            ],
            sorts: ["createdate"],
          }),
        }
      )
      const data = await res.json()
      return data.results ?? []
    } catch (err) {
      console.error("[HubSpotProvider] searchCompanies failed:", err)
      return []
    }
  }

  private async getOwners(
    headers: Record<string, string>
  ): Promise<HubSpotOwner[]> {
    try {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/owners/?limit=100`, {
        headers,
      })
      const data = await res.json()
      return data.results ?? []
    } catch (err) {
      console.error("[HubSpotProvider] getOwners failed:", err)
      return []
    }
  }

  private async getOpenDealsForCompany(
    companyId: string,
    headers: Record<string, string>
  ): Promise<HubSpotDeal[]> {
    try {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v4/objects/companies/${companyId}/associations/deals?limit=10`,
        { headers }
      )
      const assocData = await assocRes.json()
      const dealIds = (assocData.results ?? []).map(
        (r: { toObjectId: number | string }) => String(r.toObjectId)
      )

      if (dealIds.length === 0) return []

      const batchRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/deals/batch/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: [
              "dealname",
              "dealstage",
              "amount",
              "closedate",
              "hubspot_owner_id",
              "hs_is_open",
            ],
            propertiesWithHistory: [],
            inputs: dealIds.map((id: string) => ({ id })),
          }),
        }
      )
      const batchData = await batchRes.json()
      return (batchData.results ?? []).filter(
        (d: HubSpotDeal) => d.properties.hs_is_open === "true"
      )
    } catch (err) {
      console.error("[HubSpotProvider] getOpenDealsForCompany failed:", err)
      return []
    }
  }

  private async getOpenDealsForContact(
    contactId: string,
    headers: Record<string, string>
  ): Promise<HubSpotDeal[]> {
    try {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v4/objects/contacts/${contactId}/associations/deals?limit=10`,
        { headers }
      )
      const assocData = await assocRes.json()
      const dealIds = (assocData.results ?? []).map(
        (r: { toObjectId: number | string }) => String(r.toObjectId)
      )

      if (dealIds.length === 0) return []

      const batchRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/deals/batch/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: [
              "dealname",
              "dealstage",
              "amount",
              "closedate",
              "hubspot_owner_id",
              "hs_is_open",
            ],
            inputs: dealIds.map((id: string) => ({ id })),
          }),
        }
      )
      const batchData = await batchRes.json()
      return (batchData.results ?? []).filter(
        (d: HubSpotDeal) => d.properties.hs_is_open === "true"
      )
    } catch (err) {
      console.error("[HubSpotProvider] getOpenDealsForContact failed:", err)
      return []
    }
  }

  private async getNotesForContact(
    contactId: string,
    headers: Record<string, string>
  ): Promise<HubSpotNote[]> {
    try {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v4/objects/contacts/${contactId}/associations/notes?limit=5`,
        { headers }
      )
      const assocData = await assocRes.json()
      const noteIds = (assocData.results ?? []).map(
        (r: { toObjectId: number | string }) => String(r.toObjectId)
      )

      if (noteIds.length === 0) return []

      const batchRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/notes/batch/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: ["hs_note_body", "hs_timestamp"],
            inputs: noteIds.map((id: string) => ({ id })),
          }),
        }
      )
      const batchData = await batchRes.json()
      const notes: HubSpotNote[] = batchData.results ?? []
      return notes.sort((a, b) => {
        const ta = new Date(a.properties.hs_timestamp ?? 0).getTime()
        const tb = new Date(b.properties.hs_timestamp ?? 0).getTime()
        return tb - ta
      })
    } catch (err) {
      console.error("[HubSpotProvider] getNotesForContact failed:", err)
      return []
    }
  }

  private async getOpenTasksForContact(
    contactId: string,
    headers: Record<string, string>
  ): Promise<HubSpotTask[]> {
    try {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v4/objects/contacts/${contactId}/associations/tasks?limit=10`,
        { headers }
      )
      const assocData = await assocRes.json()
      const taskIds = (assocData.results ?? []).map(
        (r: { toObjectId: number | string }) => String(r.toObjectId)
      )

      if (taskIds.length === 0) return []

      const batchRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/tasks/batch/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: [
              "hs_task_subject",
              "hs_task_status",
              "hs_task_priority",
              "hs_timestamp",
            ],
            inputs: taskIds.map((id: string) => ({ id })),
          }),
        }
      )
      const batchData = await batchRes.json()
      const tasks: HubSpotTask[] = batchData.results ?? []
      return tasks
        .filter((t) => t.properties.hs_task_status !== "COMPLETED")
        .sort((a, b) => {
          const ta = new Date(a.properties.hs_timestamp ?? 0).getTime()
          const tb = new Date(b.properties.hs_timestamp ?? 0).getTime()
          return ta - tb
        })
    } catch (err) {
      console.error("[HubSpotProvider] getOpenTasksForContact failed:", err)
      return []
    }
  }

  private async getTicketsForContact(
    contactId: string,
    headers: Record<string, string>
  ): Promise<HubSpotTicket[]> {
    try {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v4/objects/contacts/${contactId}/associations/tickets?limit=5`,
        { headers }
      )
      const assocData = await assocRes.json()
      const ticketIds = (assocData.results ?? []).map(
        (r: { toObjectId: number | string }) => String(r.toObjectId)
      )

      if (ticketIds.length === 0) return []

      const batchRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/tickets/batch/read`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            properties: [
              "subject",
              "content",
              "hs_ticket_priority",
              "hs_pipeline_stage",
              "createdate",
            ],
            inputs: ticketIds.map((id: string) => ({ id })),
          }),
        }
      )
      const batchData = await batchRes.json()
      return (batchData.results ?? []) as HubSpotTicket[]
    } catch (err) {
      console.error("[HubSpotProvider] getTicketsForContact failed:", err)
      return []
    }
  }
}
