import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const SLACK_API = "https://slack.com/api"

interface SlackMessage {
  text: string
  user: string
  username: string
  channel: { name: string }
  ts: string
  permalink: string
}

interface SlackSearchResponse {
  ok: boolean
  error?: string
  messages?: {
    matches: SlackMessage[]
    total: number
  }
}

export class SlackProvider implements ContextProvider {
  id = "slack"
  name = "Slack"

  constructor(private token: string) {}

  relevantIntents: EmailIntent[] = [
    "question",
    "task_assignment",
    "follow_up",
    "status_update",
    "approval",
    "complaint",
    "general",
  ]

  async fetchContext(
    email: IncomingEmail,
    entities: EmailEntities,
    userId: string
  ): Promise<ContextCard | null> {
    const token = this.token
    if (!token) return null

    let userClerk: { firstName?: string | null; lastName?: string | null }
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(userId)
      userClerk = u
    } catch {
      return null
    }

    const userFullName = [userClerk.firstName, userClerk.lastName].filter(Boolean).join(" ")
    const query = this.buildQuery(email, entities, userFullName)

    try {
      const searchUrl = new URL(`${SLACK_API}/search.messages`)
      searchUrl.searchParams.set("query", query)
      searchUrl.searchParams.set("count", "6");
      searchUrl.searchParams.set("sort", "score");

      const res = await fetch(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data: SlackSearchResponse = await res.json()
      if (!data.ok || !data.messages?.matches?.length) return null

      const summaryLines = data.messages.matches.slice(0, 5).map((m) => {
        const cleanText = m.text
          .replace(/<[^>]+>/g, "")
          .replace(/\n+/g, " ")
          .trim()
          .slice(0, 200)
        const channel = m.channel?.name ?? "unknown"
        const user = m.username || m.user
        return `- #${channel} | ${user}: ${cleanText}`
      })

      const summary = `Relevant Slack messages (${data.messages.total} total matches):\n${summaryLines.join("\n")}`

      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "medium",
        summary,
        data: data.messages.matches.slice(0, 5),
      }
    } catch {
      return null
    }
  }

  private buildQuery(
    email: IncomingEmail,
    entities: EmailEntities,
    userName: string
  ): string {
    const parts: string[] = []

    if (email.senderName) {
      parts.push(email.senderName)
    }

    if (userName) {
      parts.push(userName)
    }

    const keywords = entities.keywords.slice(0, 5)
    if (keywords.length > 0) {
      parts.push(keywords.join(" "))
    }

    return parts.join(" ")
  }
}
