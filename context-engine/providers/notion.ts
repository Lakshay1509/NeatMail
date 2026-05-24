import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const NOTION_API = "https://api.notion.com/v1"
const NOTION_VERSION = "2026-03-11"

interface NotionPartialPage {
  object: string
  id: string
}

interface NotionFullPage {
  object: string
  id: string
  created_time: string
  last_edited_time: string
  in_trash: boolean
  url: string
  properties: Record<string, unknown>
}

type NotionPageResult = NotionFullPage | NotionPartialPage

interface NotionSearchResponse {
  object: string
  results: Array<{ object: string; id: string; [key: string]: unknown }>
  next_cursor: string | null
  has_more: boolean
}

interface NotionMarkdownResponse {
  object: string
  id: string
  markdown: string
  truncated: boolean
  unknown_block_ids: string[]
}

interface NotionComment {
  object: string
  id: string
  discussion_id: string
  created_time: string
  last_edited_time: string
  rich_text: Array<{ plain_text: string }>
}

interface NotionCommentsResponse {
  object: string
  type: string
  comment: Record<string, never>
  results: NotionComment[]
  next_cursor: string | null
  has_more: boolean
}

function isFullPage(page: NotionPageResult): page is NotionFullPage {
  return "properties" in page && "url" in page
}

function extractTitle(page: NotionPageResult): string {
  if (!isFullPage(page)) return "Untitled"
  for (const prop of Object.values(page.properties)) {
    const p = prop as Record<string, unknown>
    if (p.type === "title") {
      const titleArr = p.title as Array<{ plain_text: string }> | undefined
      if (titleArr?.length) {
        return titleArr.map((t) => t.plain_text).join("")
      }
    }
  }
  return "Untitled"
}

export class NotionProvider implements ContextProvider {
  id = "notion"
  name = "Notion"

  relevantIntents: EmailIntent[] = [
    "question",
    "task_assignment",
    "follow_up",
    "status_update",
    "approval",
    "general",
  ]

  async fetchContext(
    email: IncomingEmail,
    entities: EmailEntities,
    userId: string
  ): Promise<ContextCard | null> {
    console.log(`[Notion] fetchContext started for user=${userId}`)
    console.log(`[Notion] Email subject="${email.subject}" senderName="${email.senderName}" keywords=${JSON.stringify(entities.keywords)} intent=${entities.intent}`)

    let token: string
    try {
      const client = await clerkClient()
      const tokenResponse = await client.users.getUserOauthAccessToken(
        userId,
        "notion"
      )
      token = tokenResponse.data[0]?.token
      console.log(`[Notion] OAuth token retrieved: ${token ? "yes" : "NO"}`)
      if (!token) {
        console.warn(`[Notion] No OAuth token found for user=${userId}`)
        return null
      }
    } catch (err) {
      console.error(`[Notion] OAuth token fetch failed for user=${userId}:`, err)
      return null
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    }

    const queries: string[] = []

    if (email.senderName) {
      const nameParts = email.senderName.split(/\s+/)
      queries.push(email.senderName)
      if (nameParts.length >= 2) {
        queries.push(nameParts[0])
        queries.push(nameParts[nameParts.length - 1])
      }
    }

    const keywords = entities.keywords.slice(0, 5)
    if (keywords.length > 0) {
      queries.push(keywords.join(" "))
    }

    const uniqueQueries = [...new Set(queries.filter(Boolean))]
    console.log(`[Notion] Search queries=${JSON.stringify(uniqueQueries)}`)

    const searchResults = await Promise.allSettled(
      uniqueQueries.slice(0, 4).map((query) =>
        fetch(`${NOTION_API}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query,
            filter: { property: "object", value: "page" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
            page_size: 5,
          }),
        }).then((res) => res.json() as Promise<NotionSearchResponse>)
      )
    )

    searchResults.forEach((r, idx) => {
      const status = r.status === "fulfilled" ? "ok" : "err"
      const count = r.status === "fulfilled" && r.value.results ? r.value.results.length : 0
      console.log(`[Notion] Query #${idx} status=${status} results=${count}`)
    })

    const allRaw: Array<{ object: string; id: string; [key: string]: unknown }> = []
    for (const result of searchResults) {
      if (result.status === "fulfilled" && result.value.results?.length) {
        allRaw.push(...result.value.results)
      }
    }
    console.log(`[Notion] Total raw search results=${allRaw.length}`)

    let usedFallback = false
    if (allRaw.length === 0) {
      console.log(`[Notion] No query results — running fallback recent-pages search`)
      usedFallback = true
      const fallbackRes = await fetch(`${NOTION_API}/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          filter: { property: "object", value: "page" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          page_size: 5,
        }),
      })
      const fallbackData: NotionSearchResponse = await fallbackRes.json()
      if (fallbackData.results?.length) {
        console.log(`[Notion] Fallback returned ${fallbackData.results.length} pages`)
        allRaw.push(...fallbackData.results)
      } else {
        console.warn(`[Notion] Fallback also returned nothing — bailing`)
        return null
      }
    } else {
      console.log(`[Notion] Skipping fallback because initial search found ${allRaw.length} result(s)`)
    }

    const seen = new Set<string>()
    const uniquePages: NotionPageResult[] = []

    for (const raw of allRaw) {
      if (seen.has(raw.id)) continue
      if (raw.object !== "page") continue

      const page = raw as unknown as NotionPageResult
      if (isFullPage(page) && page.in_trash) {
        continue
      }

      seen.add(raw.id)
      uniquePages.push(page)
    }

    console.log(`[Notion] Unique pages after dedup=${uniquePages.length}`)
    uniquePages.forEach((p, i) => {
      console.log(`[Notion] Page #${i}: id=${p.id} title="${extractTitle(p)}"`)
    })

    if (uniquePages.length === 0) {
      console.warn(`[Notion] No valid unique pages found — bailing`)
      return null
    }

    const isSenderMatch = (page: NotionPageResult): boolean => {
      const title = extractTitle(page).toLowerCase()
      return queries.some((q) => title.includes(q.toLowerCase()))
    }

    const topPages = uniquePages.slice(0, 5)
    const senderPages = topPages.filter(isSenderMatch)
    const anySenderMatch = senderPages.length > 0

    const contentSnippets: string[] = []
    const commentSnippets: string[] = []

    if (topPages.length > 0) {
      const topPage = topPages[0]
      console.log(`[Notion] Fetching markdown+comments for topPage[0] id=${topPage.id} title="${extractTitle(topPage)}"`)
      const [markdownRes, commentsRes] = await Promise.allSettled([
        fetch(`${NOTION_API}/pages/${topPage.id}/markdown`, {
          headers,
        }).then((res) => res.json() as Promise<NotionMarkdownResponse>),
        fetch(`${NOTION_API}/comments?block_id=${topPage.id}&page_size=3`, {
          headers,
        }).then((res) => res.json() as Promise<NotionCommentsResponse>),
      ])

      console.log(`[Notion] Markdown fetch status=${markdownRes.status}`)
      if (markdownRes.status === "fulfilled") {
        const md = markdownRes.value
        console.log(`[Notion] Markdown response has markdown=${!!md.markdown} truncated=${md.truncated} length=${md.markdown?.length ?? 0}`)
      } else {
        console.error(`[Notion] Markdown fetch failed:`, markdownRes.reason)
      }

      console.log(`[Notion] Comments fetch status=${commentsRes.status}`)
      if (commentsRes.status === "fulfilled") {
        console.log(`[Notion] Comments response results=${commentsRes.value.results?.length ?? 0}`)
      } else {
        console.error(`[Notion] Comments fetch failed:`, commentsRes.reason)
      }

      if (
        markdownRes.status === "fulfilled" &&
        markdownRes.value.markdown
      ) {
        const content = markdownRes.value.markdown
          .replace(/#{1,6}\s+/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, 600)
        if (content) {
          contentSnippets.push(
            `Recent content from "${extractTitle(topPage)}":\n${content}${content.length >= 600 ? "..." : ""}`
          )
        }
      }

      if (
        commentsRes.status === "fulfilled" &&
        commentsRes.value.results?.length
      ) {
        const lines = commentsRes.value.results.slice(0, 3).map((c) => {
          const text = c.rich_text
            .map((t) => t.plain_text)
            .join(" ")
            .slice(0, 150)
          const date = new Date(c.last_edited_time).toLocaleDateString()
          return `- ${text} (${date})`
        })
        if (lines.length) {
          commentSnippets.push(
            `Unresolved comments on "${extractTitle(topPage)}":\n${lines.join("\n")}`
          )
        }
      }
    }

    const summaryLines = topPages.map((p) => {
      const title = extractTitle(p)
      if (isFullPage(p)) {
        const edited = new Date(p.last_edited_time).toLocaleDateString()
        return `- ${title} (last edited: ${edited})`
      }
      return `- ${title}`
    })

    const extraBlocks = [...contentSnippets, ...commentSnippets]
      .filter(Boolean)
      .join("\n\n")

    const summary =
      `Relevant Notion pages (${uniquePages.length} found):\n${summaryLines.join("\n")}` +
      (extraBlocks ? `\n\n${extraBlocks}` : "")

    console.log(`[Notion] Returning card relevance=${anySenderMatch ? "high" : "medium"} summaryLength=${summary.length}`)
    console.log(`[Notion] Summary preview:\n${summary.slice(0, 500)}${summary.length > 500 ? "..." : ""}`)

    return {
      providerId: this.id,
      providerName: this.name,
      relevance: anySenderMatch ? "high" : "medium",
      summary,
      data: topPages,
    }
  }
}
