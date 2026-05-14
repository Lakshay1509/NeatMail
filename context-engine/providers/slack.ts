import { clerkClient } from "@clerk/nextjs/server"
import { db } from "@/lib/prisma"
import { encrypt, decrypt } from "@/lib/encode"
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
    // TODO: remove debug logs
    console.log("[SlackProvider] fetchContext called", { userId, senderName: email.senderName, subject: email.subject, keywords: entities.keywords, intent: entities.intent })

    const token = await this.getValidToken(userId)
    // TODO: remove debug logs
    console.log("[SlackProvider] token after getValidToken:", token ? token.slice(0, 20) + "..." : null)
    if (!token) return null

    let userClerk: { firstName?: string | null; lastName?: string | null }
    try {
      const client = await clerkClient()
      const u = await client.users.getUser(userId)
      userClerk = u
    } catch {
      // TODO: remove debug logs
      console.log("[SlackProvider] clerkClient.getUser failed")
      return null
    }

    const userFullName = [userClerk.firstName, userClerk.lastName].filter(Boolean).join(" ")
    const query = this.buildQuery(email, entities, userFullName)
    // TODO: Remove console logs in production
    console.log("[SlackProvider] Built query:", query)

    try {
      const searchUrl = new URL(`${SLACK_API}/search.messages`)
      searchUrl.searchParams.set("query", query)
      searchUrl.searchParams.set("count", "5")
      searchUrl.searchParams.set("sort", "timestamp")

      // TODO: remove debug logs
      console.log("[SlackProvider] Fetching URL:", searchUrl.toString())

      const res = await fetch(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })

      const data: SlackSearchResponse = await res.json()
      // TODO: Remove console logs in production
      console.log("[SlackProvider] Raw Slack response:", JSON.stringify(data).slice(0, 2000))
      console.log("[SlackProvider] Search response:", { ok: data.ok, total: data.messages?.total, matches: data.messages?.matches?.length })
      if (!data.ok) {
        // TODO: remove debug logs
        console.log("[SlackProvider] Slack returned !ok:", data.error ?? "no error field")
        return null
      }
      if (!data.messages?.matches?.length) {
        // TODO: remove debug logs
        console.log("[SlackProvider] No matches. messages field:", JSON.stringify(data.messages).slice(0, 500))
        return null
      }

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

      // TODO: Remove console logs in production
      console.log(summary)

      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "medium",
        summary,
        data: data.messages.matches.slice(0, 5),
      }
    } catch (err) {
      console.error("[SlackProvider] search failed:", err)
      return null
    }
  }

  private async getValidToken(userId: string): Promise<string | null> {
    // TODO: remove debug logs
    console.log("[SlackProvider] getValidToken called", { userId })

    const integration = await db.slack_integration.findUnique({
      where: { user_id: userId },
      select: { access_token: true, refresh_token: true, token_expires_at: true },
    })
    if (!integration) {
      // TODO: remove debug logs
      console.log("[SlackProvider] No DB integration, falling back to constructor token:", this.token ? this.token.slice(0, 20) + "..." : "null")
      return this.token
    }

    // TODO: remove debug logs
    console.log("[SlackProvider] Found integration, expires_at:", integration.token_expires_at)

    if (
      !integration.token_expires_at ||
      integration.token_expires_at.getTime() > Date.now() + 300000
    ) {
      const token = await decrypt(integration.access_token)
      console.log("[SlackProvider] Decrypted token:", token.slice(0, 20) + "...")
      return token
    }

    // TODO: remove debug logs
    console.log("[SlackProvider] Token expired, attempting refresh")

    if (!integration.refresh_token) {
      // TODO: remove debug logs
      console.log("[SlackProvider] No refresh token available")
      return null
    }

    const decryptedRefresh = await decrypt(integration.refresh_token)

    const body = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: decryptedRefresh,
    })

    try {
      const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
      const data = await res.json()
      if (!data.ok) return null

      const [encryptedToken, encryptedRefresh] = await Promise.all([
        encrypt(data.access_token),
        data.refresh_token ? encrypt(data.refresh_token) : Promise.resolve(null),
      ])

      await db.slack_integration.update({
        where: { user_id: userId },
        data: {
          access_token: encryptedToken,
          refresh_token: encryptedRefresh ?? integration.refresh_token,
          token_expires_at: data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : null,
        },
      })

      return data.access_token
    } catch {
      return null
    }
  }

  private buildQuery(
    email: IncomingEmail,
    entities: EmailEntities,
    userName: string
  ): string {
    // TODO: remove debug logs
    console.log("[SlackProvider] buildQuery inputs:", { senderName: email.senderName, userName, keywords: entities.keywords })

    const parts: string[] = []

    if (email.senderName) {
      parts.push(email.senderName)
    }

    if (userName) {
      parts.push(userName)
    }

    const keywords = entities.keywords.slice(0, 5)
    // TODO: remove debug logs
    console.log("[SlackProvider] Keywords after slice(0,5):", keywords, "(dropped:", entities.keywords.slice(5), ")")

    if (keywords.length > 0) {
      parts.push(keywords.join(" "))
    }

    // TODO: remove debug logs
    console.log("[SlackProvider] Final parts:", parts)
    return parts.join(" ")
  }
}
