import { clerkClient } from "@clerk/nextjs/server"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const GITHUB_API = "https://api.github.com"

interface GitHubUser {
  login: string
  id: number
  name: string | null
  email: string | null
  bio: string | null
  company: string | null
  html_url: string
  avatar_url: string
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
  visibility: string | null
}

interface GitHubOrg {
  login: string
  id: number
  avatar_url: string
}

interface GitHubSearchUsersResponse {
  total_count: number
  incomplete_results: boolean
  items: Array<{
    login: string
    id: number
    name: string | null
    email: string | null
    bio: string | null
    company: string | null
    html_url: string
    avatar_url: string
    score: number
  }>
}

interface GitHubIssueItem {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  repository_url: string
  user: { login: string } | null
  labels: Array<{ name: string }>
  created_at: string
  updated_at: string
  pull_request?: Record<string, unknown>
}

interface GitHubSearchIssuesResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubIssueItem[]
}

export class GitHubProvider implements ContextProvider {
  id = "github"
  name = "GitHub"

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
        "github"
      )
      token = tokenResponse.data[0]?.token
      if (!token) return null
    } catch {
      return null
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "neatmail-context-engine",
    }

    const [profile, emails, myOrgs] = await Promise.all([
      this.fetchGitHub<GitHubUser>(`${GITHUB_API}/user`, headers),
      this.fetchGitHub<GitHubEmail[]>(`${GITHUB_API}/user/emails`, headers),
      this.fetchGitHub<GitHubOrg[]>(`${GITHUB_API}/user/orgs`, headers),
    ])

    const parts: string[] = []

    if (profile) {
      parts.push(
        `Your GitHub profile: @${profile.login}` +
          (profile.name ? ` (${profile.name})` : "") +
          (profile.company ? ` — ${profile.company}` : "") +
          (profile.bio ? `\nBio: ${profile.bio}` : "")
      )
    }

    if (emails && emails.length > 0) {
      const primary = emails.find((e) => e.primary)
      if (primary) {
        parts.push(`Primary GitHub email: ${primary.email}`)
      }
    }

    if (myOrgs && myOrgs.length > 0) {
      const orgNames = myOrgs.map((o) => o.login).join(", ")
      parts.push(`GitHub orgs you belong to: ${orgNames}`)
    }

    let senderLogin: string | null = null

    if (email.senderName) {
      const nameQuery = encodeURIComponent(
        `fullname:"${email.senderName}" type:user`
      )
      senderLogin = await this.trySearchUser(nameQuery, headers, parts)
    }

    if (!senderLogin && email.senderEmail) {
      const emailLocal = email.senderEmail.split("@")[0]
      if (emailLocal && emailLocal.length >= 2) {
        const emailQuery = encodeURIComponent(
          `${emailLocal} in:email type:user`
        )
        senderLogin = await this.trySearchUser(emailQuery, headers, parts)
      }
    }

    const keywordsForSearch = entities.keywords.slice(0, 3)
    const searchTerms: string[] = []

    if (senderLogin) {
      searchTerms.push(`involves:${senderLogin}`)
    } else if (email.senderName) {
      searchTerms.push(`"${email.senderName}"`)
    }

    for (const kw of keywordsForSearch) {
      searchTerms.push(kw)
    }

    let issueQuery = searchTerms.join(" ").trim()
    if (issueQuery.length > 256) {
      issueQuery = issueQuery.slice(0, 256)
    }

    if (issueQuery) {
      try {
        const issuesRes = await fetch(
          `${GITHUB_API}/search/issues?q=${encodeURIComponent(issueQuery)}&per_page=5&sort=updated&order=desc`,
          { headers }
        )
        if (issuesRes.ok) {
          const issuesData: GitHubSearchIssuesResponse =
            await issuesRes.json()
          if (issuesData.items?.length) {
            const issueLines = issuesData.items.slice(0, 5).map((item) => {
              const type = item.pull_request ? "PR" : "Issue"
              const repo =
                item.repository_url.split("/repos/")[1] ?? "unknown"
              const state = item.state === "open" ? "OPEN" : "closed"
              const labels = item.labels?.length
                ? ` [${item.labels.map((l) => l.name).join(", ")}]`
                : ""
              const by = item.user?.login ?? "unknown"
              return `- ${type} #${item.number} in ${repo}: ${item.title} (${state} by @${by}${labels})`
            })
            parts.push(
              `\nRelevant GitHub issues/PRs:\n${issueLines.join("\n")}`
            )
          }
        }
      } catch {
        // search failures are non-fatal
      }
    }

    if (parts.length === 0) return null

    return {
      providerId: this.id,
      providerName: this.name,
      relevance: senderLogin ? "high" : "medium",
      summary: `GitHub context:\n${parts.join("\n\n")}`,
      data: { profile, senderLogin },
    }
  }

  private async trySearchUser(
    query: string,
    headers: Record<string, string>,
    parts: string[]
  ): Promise<string | null> {
    try {
      const res = await fetch(
        `${GITHUB_API}/search/users?q=${query}&per_page=3`,
        { headers }
      )
      if (!res.ok) return null
      const data: GitHubSearchUsersResponse = await res.json()
      if (!data.items?.length) return null

      const top = data.items[0]
      const login = top.login
      parts.push(
        `Sender on GitHub: @${login}` +
          (top.name ? ` (${top.name})` : "") +
          (top.company ? ` — ${top.company}` : "") +
          (top.bio ? `\nBio: ${top.bio}` : "")
      )

      const senderOrgs = await this.fetchGitHub<GitHubOrg[]>(
        `${GITHUB_API}/users/${login}/orgs`,
        headers
      )
      if (senderOrgs && senderOrgs.length > 0) {
        const orgsList = senderOrgs.map((o) => o.login).join(", ")
        parts.push(`Sender's GitHub orgs: ${orgsList}`)
      }

      return login
    } catch {
      return null
    }
  }

  private async fetchGitHub<T>(
    url: string,
    headers: Record<string, string>
  ): Promise<T | null> {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }
}
