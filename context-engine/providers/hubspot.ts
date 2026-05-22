import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const HUBSPOT_API = "https://api.hubapi.com"

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
    let token: string
    try {
      const client = await clerkClient()
      const tokenResponse = await client.users.getUserOauthAccessToken(
        userId,
        "hubspot"
      )
      token = tokenResponse.data[0]?.token
      if (!token) return null
    } catch {
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

    let deals: HubSpotDeal[] = []
    if (companies.length > 0) {
      deals = await this.getOpenDealsForCompany(companies[0].id, headers)
    } else if (contacts.length > 0) {
      const contactCompanyId = contacts[0].properties.associatedcompanyid
      if (contactCompanyId) {
        deals = await this.getOpenDealsForCompany(contactCompanyId, headers)
      }
    }

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

      parts.push(`Contact: ${name || "Unnamed"} (${c.email ?? email.senderEmail})`)
      if (c.jobtitle) parts.push(`Title: ${c.jobtitle}`)
      if (c.company) parts.push(`Company: ${c.company}`)
      if (c.phone) parts.push(`Phone: ${c.phone}`)
      parts.push(`Owner: ${ownerName}`)
      if (c.lifecyclestage) parts.push(`Lifecycle: ${c.lifecyclestage}`)
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
      for (const d of deals.slice(0, 5)) {
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

    if (parts.length === 0) return null

    const contactExists = contacts.length > 0
    const relevance = contactExists
      ? "high"
      : companies.length > 0
        ? "medium"
        : "low"

    return {
      providerId: this.id,
      providerName: this.name,
      relevance,
      summary: `HubSpot CRM:\n${parts.join("\n")}`,
      data: { contacts, companies, deals },
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
          ],
          sorts: ["createdate"],
        }),
      })
      const data = await res.json()
      return data.results ?? []
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
      return []
    }
  }
}
