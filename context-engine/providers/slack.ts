import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_API = "https://slack.com/api"
const SEARCH_COUNT = 10       // fetch more, deduplicate down to MAX_RESULTS
const MAX_RESULTS = 5
const RECENCY_MONTHS = 3      // only search messages from the last 6 months
const MAX_MESSAGE_LENGTH = 300

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackMessage {
  text: string
  user: string
  username: string
  channel: { id: string; name: string; is_private?: boolean }
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

interface SlackUserLookupResponse {
  ok: boolean
  user?: { id: string; name: string }
  error?: string
}

// ---------------------------------------------------------------------------
// Pure helpers (no side-effects, easy to unit-test)
// ---------------------------------------------------------------------------

/**
 * Converts Slack's mrkdwn markup to readable plain text.
 * Handles user mentions, channel mentions, hyperlinks, and HTML entities.
 */
function cleanSlackText(raw: string): string {
  return raw
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")   // <@U123|name>  → @name
    .replace(/<@[A-Z0-9]+>/g, "@user")             // <@U123>       → @user
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")     // <#C123|chan>  → #chan
    .replace(/<#[A-Z0-9]+>/g, "#channel")           // <#C123>       → #channel
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")         // <url|label>   → label
    .replace(/<([^>]+)>/g, "$1")                    // <url>         → url
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
}

/**
 * Derives a relevance tier from the total Slack match count.
 * More matches = Slack genuinely has context on this sender/topic.
 */
function computeRelevance(totalMatches: number): "high" | "medium" | "low" {
  if (totalMatches >= 10) return "high"
  if (totalMatches >= 3) return "medium"
  return "low"
}

/**
 * Returns an ISO date string N months ago, used for Slack's `after:` operator.
 */
function recencyCutoff(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().split("T")[0]
}

/**
 * Removes near-duplicate messages (same channel within the same 60-second window).
 * Prevents thread bursts from dominating the result set.
 */
function deduplicate(messages: SlackMessage[]): SlackMessage[] {
  const seen = new Set<string>()
  return messages.filter((m) => {
    const bucket = Math.floor(parseFloat(m.ts) / 60)
    const key = `${m.channel?.id ?? ""}:${bucket}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Formats a Unix timestamp (Slack's `ts`) to a short human-readable date.
 */
function formatDate(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class SlackProvider implements ContextProvider {
  id = "slack"
  name = "Slack"

  // Selective — Slack context is noise for complaint/general emails
  relevantIntents: EmailIntent[] = [
    "question",
    "task_assignment",
    "follow_up",
    "status_update",
    "approval",
  ]

  constructor(private token: string) {}

  async fetchContext(
    email: IncomingEmail,
    entities: EmailEntities,
    _userId: string
  ): Promise<ContextCard | null> {
    if (!this.token) return null

    // Optionally resolve sender email → Slack user ID for a precise `from:` filter
    const senderSlackId = email.senderEmail
      ? await this.lookupSlackUserId(email.senderEmail)
      : null

    const query = this.buildQuery(email, entities, senderSlackId)
    if (!query.trim()) return null

    let data: SlackSearchResponse
    try {
      const url = new URL(`${SLACK_API}/search.messages`)
      url.searchParams.set("query", query)
      url.searchParams.set("count", String(SEARCH_COUNT))
      url.searchParams.set("sort", "score")

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.token}` },
      })

      if (!res.ok) {
        console.error(`[SlackProvider] HTTP ${res.status} from Slack search`)
        return null
      }

      data = (await res.json()) as SlackSearchResponse
    } catch (err) {
      console.error("[SlackProvider] Network error during search:", err)
      return null
    }

    if (!data.ok) {
      console.error(`[SlackProvider] Slack API error: ${data.error}`)
      return null
    }

    const matches = data.messages?.matches ?? []
    if (!matches.length) return null

    const results = deduplicate(matches).slice(0, MAX_RESULTS)
    const total = data.messages?.total ?? matches.length

    const summaryLines = results.map((m) => {
      const text = cleanSlackText(m.text)
      const channel = m.channel?.name ?? "unknown"
      const user = m.username || m.user
      const date = formatDate(m.ts)
      // Include permalink so the LLM or UI can deep-link
      return `- [${date}] #${channel} | ${user}: ${text}${m.permalink ? `\n  ${m.permalink}` : ""}`
    })

    const summary = [
      `Slack context — ${total} match${total !== 1 ? "es" : ""} for "${email.senderName ?? email.senderEmail}":`,
      ...summaryLines,
    ].join("\n")

    return {
      providerId: this.id,
      providerName: this.name,
      relevance: computeRelevance(total),
      summary,
      data: results,
    }
  }

  // ---------------------------------------------------------------------------
  // Query construction
  // ---------------------------------------------------------------------------

  private buildQuery(
    email: IncomingEmail,
    entities: EmailEntities,
    senderSlackId: string | null
  ): string {
    const parts: string[] = []

    // Prefer a resolved Slack user ID — most precise signal
    if (senderSlackId) {
      parts.push(`from:<@${senderSlackId}>`)
    } else if (email.senderName?.trim()) {
      // Quoted exact-match on name — avoids partial word collisions
      parts.push(`"${email.senderName.trim()}"`)
    }

    // Top-3 meaningful keywords (skip short noise words)
    const keywords = entities.keywords
      .filter((k) => k.length > 3)
      .slice(0, 3)
    if (keywords.length) parts.push(keywords.join(" "))

    // Slack's `after:` operator — only search recent history
    parts.push(`after:${recencyCutoff(RECENCY_MONTHS)}`)

    return parts.join(" ")
  }

  // ---------------------------------------------------------------------------
  // Slack user resolution (email → Slack user ID)
  // ---------------------------------------------------------------------------

  /**
   * Tries to find the sender's Slack user ID via their email address.
   * Requires the `users:read.email` OAuth scope.
   * Returns null on any failure — the query falls back to name-based search.
   */
  private async lookupSlackUserId(email: string): Promise<string | null> {
    try {
      const url = new URL(`${SLACK_API}/users.lookupByEmail`)
      url.searchParams.set("email", email)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.token}` },
      })

      if (!res.ok) return null

      const data = (await res.json()) as SlackUserLookupResponse
      return data.ok && data.user?.id ? data.user.id : null
    } catch {
      // Non-fatal — degrade gracefully to name-based search
      return null
    }
  }
}