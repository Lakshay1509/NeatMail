import { clerkClient } from "@clerk/nextjs/server"
import { redis } from "@/lib/redis"
import {
  ContextProvider,
  ContextCard,
  EmailEntities,
  EmailIntent,
  IncomingEmail,
} from "../types"

const GITHUB_API = "https://api.github.com"
const REPO_CACHE_TTL = 3600

// ── Interfaces ─────────────────────────────────────────────

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

interface GitHubOrg {
  login: string
  id: number
  avatar_url: string
}

interface GitHubRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  html_url: string
  private: boolean
  pushed_at: string | null
}

interface GitHubPullRequest {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  body: string | null
  user: { login: string; html_url: string } | null
  assignees: Array<{ login: string }> | null
  head: { label: string; ref: string; sha: string }
  base: { label: string; ref: string; sha: string }
  created_at: string
  updated_at: string
  merged: boolean
  mergeable: boolean | null
  mergeable_state: string
  draft: boolean
  additions: number
  deletions: number
  changed_files: number
  labels: Array<{ name: string; color: string }>
}

interface GitHubIssue {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  body: string | null
  user: { login: string } | null
  labels: Array<{ name: string }>
  created_at: string
  updated_at: string
  assignees: Array<{ login: string }>
}

interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  author: { login: string; html_url: string } | null
  html_url: string
}

interface GitHubMilestone {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  open_issues: number
  closed_issues: number
  due_on: string | null
  created_at: string
  updated_at: string
}

interface GitHubCheckRunsResponse {
  total_count: number
  check_runs: Array<{
    name: string
    status: string
    conclusion: string | null
  }>
}

interface RouterDecision {
  mode: "targeted" | "snapshot"
  reason: string
  repo: string | null
  prNumber: number | null
  filters: string[]
  timeRange: { since?: string; sort?: string } | null
}

// ── Bot detection ──────────────────────────────────────────

const BOT_KEYWORDS = ["snyk", "dependabot", "renovate", "github-actions", "security"]
const BOT_LOGINS = [
  "snyk-bot",
  "dependabot[bot]",
  "dependabot-preview[bot]",
  "renovate[bot]",
  "github-actions[bot]",
]
const NON_GITHUB_SENDER_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "yahoo.com",
  "hotmail.com",
  "protonmail.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "snyk.io",
  "dependabot.com",
  "github.com",
])

// ── Utility Functions ──────────────────────────────────────

function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return ""
  return html.replace(/<[^>]*>?/gm, "").trim()
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max).trimEnd() + " ..."
}

function relativeTime(isoDate: string): string {
  const then = new Date(isoDate).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffDay > 30) return `${Math.floor(diffDay / 30)}mo ago`
  if (diffDay > 0) return `${diffDay}d ago`
  if (diffHr > 0) return `${diffHr}h ago`
  if (diffMin > 0) return `${diffMin}m ago`
  return "just now"
}

function timeRangeToISO(text: string): { since?: string; sort?: string } | null {
  const lower = text.toLowerCase()

  if (/\bthis\s+week\b/.test(lower)) {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return { since: d.toISOString() }
  }
  if (/\blast\s+30\s+days?\b/.test(lower) || /\bpast\s+30\s+days?\b/.test(lower)) {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return { since: d.toISOString() }
  }
  if (/\blast\s+7\s+days?\b/.test(lower) || /\bpast\s+week\b/.test(lower)) {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return { since: d.toISOString() }
  }
  if (/\btoday\b/.test(lower)) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return { since: d.toISOString() }
  }
  if (/\blongest\s+without\b/.test(lower) || /\bsitting\b/.test(lower) || /\bstale\b/.test(lower)) {
    return { sort: "updated-asc" }
  }

  return null
}

function isCommonWord(word: string): boolean {
  const stopWords = new Set([
    "the","a","an","i","you","he","she","it","we","they","me","him","her","us","them",
    "my","your","his","its","our","their","this","that","these","those",
    "in","on","at","to","for","of","with","by","from","as","into","through","during",
    "before","after","above","below","between","under","again","further","then","once",
    "here","there","when","where","why","how","all","any","both","each","few","more",
    "most","other","some","such","no","nor","not","only","own","same","so","than",
    "too","very","just","and","but","if","or","because","until","while","about",
    "is","are","was","were","be","been","being","have","has","had","do","does","did",
    "will","would","could","should","may","might","must","shall","can","need",
    "get","got","go","went","gone","make","made","take","took","taken","see","saw",
    "seen","know","knew","known","come","came","think","thought","say","said","tell",
    "told","give","gave","given","find","found","feel","felt","become","became",
    "leave","left","put","mean","meant","keep","kept","let","begin","began","seem",
    "help","show","showed","shown","hear","heard","play","run","ran","move","live",
    "believe","bring","brought","happen","stand","stood","lose","lost","pay","paid",
    "meet","met","include","continue","set","learn","learned","change","lead","led",
    "understand","understood","watch","follow","stop","create","speak","spoke","spoken",
    "allow","add","spend","spent","grow","grew","grown","open","walk","offer","remember",
    "love","consider","appear","buy","bought","wait","serve","die","send","sent","expect",
    "build","built","stay","fall","fell","fallen","cut","reach","kill","remain","suggest",
    "raise","pass","sell","sold","require","report","decide","pull",
  ])
  return stopWords.has(word.toLowerCase())
}

function extractPRNumber(text: string): number | null {
  const m = text.match(/(?:pull|pr|#)\s*(\d+)/i)
  if (m) return parseInt(m[1], 10)
  return null
}

function extractVersionNumbers(text: string): string[] {
  const matches = text.match(/\d+\.\d+\.\d+(?:-\w+)?/g)
  return matches ? [...new Set(matches)] : []
}

function isNonGitHubSender(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? ""
  if (NON_GITHUB_SENDER_DOMAINS.has(domain)) return true
  return false
}

function resolveRepoName(
  text: string,
  myLogin: string,
  knownRepos: string[]
): { repoSlug: string | null; matchedName: string | null } {
  const lower = text.toLowerCase()

  // 1. Explicit "owner/repo"
  const strict = text.match(/([\w.-]+\/[\w.-]+)/)
  if (strict) {
    return { repoSlug: strict[1], matchedName: strict[1].split("/")[1] }
  }

  // 2. Match against known repo names
  for (const repoName of knownRepos) {
    if (lower.includes(repoName.toLowerCase())) {
      return { repoSlug: `${myLogin}/${repoName}`, matchedName: repoName }
    }
  }

  // 3. "X repo" / "repo X" pattern
  const repoCtxBefore = lower.match(/(\b[\w-]{2,}\b)\s+(?:repo|repository)/)
  if (repoCtxBefore) {
    const candidate = repoCtxBefore[1]
    if (!isCommonWord(candidate) && candidate.length >= 3) {
      return { repoSlug: `${myLogin}/${candidate}`, matchedName: candidate }
    }
  }
  const repoCtxAfter = lower.match(/(?:repo|repository)\s+(\b[\w-]{2,}\b)/)
  if (repoCtxAfter) {
    const candidate = repoCtxAfter[1]
    if (!isCommonWord(candidate) && candidate.length >= 3) {
      return { repoSlug: `${myLogin}/${candidate}`, matchedName: candidate }
    }
  }

  // 4. "the repo" / "our repo" → return null, caller uses most recent
  if (/\b(the|our|my|this)\s+repo\b/.test(lower)) {
    return { repoSlug: null, matchedName: null }
  }

  return { repoSlug: null, matchedName: null }
}

function detectBotAuthor(text: string): string | null {
  const lower = text.toLowerCase()
  for (const bot of BOT_LOGINS) {
    const botName = bot.replace("[bot]", "").toLowerCase()
    if (lower.includes(botName)) {
      return bot
    }
  }
  return null
}

// ── Security helpers ───────────────────────────────────────

function isValidRepoSlug(slug: string): boolean {
  // GitHub repo slugs: owner/repo, where both parts are alphanumeric + hyphens + dots + underscores
  // Max lengths: owner 39 chars, repo name 100 chars
  const parts = slug.split("/")
  if (parts.length !== 2) return false
  const [owner, repo] = parts
  if (!owner || !repo) return false
  if (owner.length > 39 || repo.length > 100) return false
  // GitHub usernames/repos: alphanumeric, hyphens, no leading/trailing hyphen
  const validPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/
  return validPattern.test(owner) && validPattern.test(repo)
}

function isValidPRNumber(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n < 1_000_000
}

function sanitizeForLog(text: string, maxLen = 80): string {
  // Redact email addresses, tokens, and other PII from logs
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, "[REDACTED_TOKEN]")
    .replace(/gho_[a-zA-Z0-9]{36,}/g, "[REDACTED_TOKEN]")
    .slice(0, maxLen)
}

// ── Provider ────────────────────────────────────────────────

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
    console.log("[GitHub] fetchContext called", {
      subject: sanitizeForLog(email.subject),
      intent: entities.intent,
      keywords: entities.keywords,
    })

    // ── 1. Auth ────────────────────────────────────────────
    const auth = await this.authenticate(userId)
    if (!auth) {
      console.log("[GitHub] Auth failed, returning null")
      return null
    }
    const { headers, profile } = auth

    const parts: string[] = []
    parts.push(
      `Your GitHub profile: @${profile.login}` +
        (profile.name ? ` (${profile.name})` : "") +
        (profile.company ? ` — ${profile.company}` : "") +
        (profile.bio ? `\nBio: ${profile.bio}` : "")
    )

    // ── 2. Known repos (cached) ────────────────────────────
    const knownRepos = await this.getCachedRepos(profile.login, headers, userId)
    console.log("[GitHub] Known repos:", knownRepos.length, knownRepos.slice(0, 10))

    // ── 3. Router ────────────────────────────────────────
    const decision = this.router(email, entities, profile.login, knownRepos)
    console.log("[GitHub] Router decision:", decision)

    if (!decision.repo && decision.mode === "snapshot") {
      // Use most recently pushed repo if none resolved
      decision.repo = knownRepos[0] ? `${profile.login}/${knownRepos[0]}` : null
      console.log("[GitHub] Fallback to most recent repo:", decision.repo)
    }

    if (!decision.repo) {
      console.log("[GitHub] No repo resolved, returning profile only")
      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "low",
        summary: `GitHub context:\n${parts.join("\n\n")}`,
        data: { profile },
      }
    }

    // Validate repo slug before any API calls
    if (!isValidRepoSlug(decision.repo)) {
      console.error("[GitHub] Invalid repo slug, aborting:", decision.repo)
      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "low",
        summary: `GitHub context:\n${parts.join("\n\n")}`,
        data: { profile },
      }
    }

    // ── 4. Fetch ───────────────────────────────────────────
    let foundPRs: Array<{
      repoFullName: string
      pr: GitHubPullRequest
      checks: GitHubCheckRunsResponse | null
    }> = []

    if (decision.mode === "targeted") {
      foundPRs = await this.targetedFetch(decision, headers, profile.login)
    } else {
      const snapshot = await this.snapshotFetch(decision, headers, profile.login)
      if (snapshot) {
        parts.push(snapshot)
      }
    }

    // ── 5. Render targeted results ───────────────────────
    if (decision.mode === "targeted" && foundPRs.length > 0) {
      const prLines = foundPRs.map((f) => this.formatPR(f))
      parts.push(`Focused result — open pull requests:\n${prLines.join("\n\n")}`)
    }

    // ── 6. Sender context ────────────────────────────────
    if (!isNonGitHubSender(email.senderEmail)) {
      const senderLogin = await this.findSenderGitHub(email, headers, parts)
      if (senderLogin) {
        console.log(`[GitHub] Sender matched: @${senderLogin}`)
      }
    }

    if (parts.length === 1 && parts[0].startsWith("Your GitHub profile")) {
      console.log("[GitHub] Only profile info, no context produced")
      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "low",
        summary: `GitHub context:\n${parts.join("\n\n")}`,
        data: { profile },
      }
    }

    return {
      providerId: this.id,
      providerName: this.name,
      relevance: decision.mode === "targeted" ? "high" : "medium",
      summary: `GitHub context:\n${parts.join("\n\n")}`,
      data: { profile, mode: decision.mode, repo: decision.repo },
    }
  }

  // ── Auth ─────────────────────────────────────────────────

  private async authenticate(
    userId: string
  ): Promise<{ headers: Record<string, string>; profile: GitHubUser } | null> {
    try {
      const client = await clerkClient()
      const tokenResponse = await client.users.getUserOauthAccessToken(userId, "github")
      const token = tokenResponse.data[0]?.token
      if (!token) {
        console.log("[GitHub] No OAuth token found")
        return null
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "neatmail-context-engine",
      }

      const profile = await this.fetchGitHub<GitHubUser>(`${GITHUB_API}/user`, headers, "/user")
      if (!profile) {
        console.log("[GitHub] Failed to fetch profile")
        return null
      }

      return { headers, profile }
    } catch (err) {
      console.error("[GitHub] Auth error:", err)
      return null
    }
  }

  // ── Router ───────────────────────────────────────────────

  private router(
    email: IncomingEmail,
    entities: EmailEntities,
    myLogin: string,
    knownRepos: string[]
  ): RouterDecision {
    const text = `${email.subject} ${stripHtml(email.body)}`.toLowerCase()
    const { repoSlug } = resolveRepoName(text, myLogin, knownRepos)

    const prNumber = extractPRNumber(text)
    const botAuthor = detectBotAuthor(text)
    const timeRange = timeRangeToISO(text)

    // ── Auto-targeted triggers ──────────────────────────

    if (prNumber && repoSlug) {
      return {
        mode: "targeted",
        reason: "PR number + repo known",
        repo: repoSlug,
        prNumber,
        filters: [],
        timeRange,
      }
    }

    if (botAuthor && repoSlug) {
      return {
        mode: "targeted",
        reason: "Bot PR in known repo",
        repo: repoSlug,
        prNumber: null,
        filters: ["bot"],
        timeRange,
      }
    }

    if (/\bassigned\s+to\s+(me|you)\b/.test(text) || /\bmy\s+pull\s+requests?\b/.test(text)) {
      return {
        mode: "targeted",
        reason: "Assigned-to-me filter",
        repo: repoSlug ?? null,
        prNumber: null,
        filters: ["assigned"],
        timeRange,
      }
    }

    if (/\bfailing\s+(checks?|ci|tests?)\b/.test(text)) {
      return {
        mode: "targeted",
        reason: "Failing-checks filter",
        repo: repoSlug ?? null,
        prNumber: null,
        filters: ["failing"],
        timeRange,
      }
    }

    if (/\bready\s+to\s+merge\b/.test(text) || /\bmergeable\b/.test(text)) {
      return {
        mode: "targeted",
        reason: "Ready-to-merge filter",
        repo: repoSlug ?? null,
        prNumber: null,
        filters: ["mergeable"],
        timeRange,
      }
    }

    // ── Score-based ─────────────────────────────────────

    let score = 0

    if (extractVersionNumbers(text).length > 0) score += 15
    if (repoSlug) score += 10
    if (/\b(update|review|merge|close|approve|check)\b/.test(text)) score += 10
    if (/\bpull\s+request\b/.test(text) || /\bpr\b/.test(text)) score += 5
    if (botAuthor) score += 10 // bot mentioned but no explicit repo

    if (/\b(what|how\s+many|latest|recent|newest|last|any|all|some|show|list|give\s+me|tell\s+me)\b/.test(text)) {
      score -= 10
    }
    if (!repoSlug) score -= 15

    if (score >= 30) {
      return {
        mode: "targeted",
        reason: `Score-based targeted (score=${score})`,
        repo: repoSlug ?? null,
        prNumber: prNumber,
        filters: [],
        timeRange,
      }
    }

    // ── Default: Snapshot ───────────────────────────────
    return {
      mode: "snapshot",
      reason: `Snapshot mode (score=${score})`,
      repo: repoSlug ?? null,
      prNumber: null,
      filters: [],
      timeRange,
    }
  }

  // ── Targeted Fetch ───────────────────────────────────────

  private async targetedFetch(
    decision: RouterDecision,
    headers: Record<string, string>,
    myLogin: string
  ): Promise<
    Array<{ repoFullName: string; pr: GitHubPullRequest; checks: GitHubCheckRunsResponse | null }>
  > {
    const repo = decision.repo!
    const results: Array<{
      repoFullName: string
      pr: GitHubPullRequest
      checks: GitHubCheckRunsResponse | null
    }> = []

    // Specific PR number
    if (decision.prNumber) {
      if (!isValidPRNumber(decision.prNumber)) {
        console.error("[GitHub] Invalid PR number:", decision.prNumber)
        return results
      }
      const detail = await this.fetchPR(repo, decision.prNumber, headers)
      if (detail) results.push(detail)
      return results
    }

    // List open PRs and filter
    let url = `${GITHUB_API}/repos/${repo}/pulls?state=open&per_page=20&sort=updated&direction=desc`
    if (decision.filters.includes("assigned")) {
      url += `&assignee=${myLogin}`
    }
    if (decision.timeRange?.since) {
      url += `&since=${encodeURIComponent(decision.timeRange.since)}`
    }

    const prs = await this.fetchGitHub<GitHubPullRequest[]>(url, headers, `open PRs in ${repo}`)
    if (!prs) return results

    for (const pr of prs) {
      if (results.length >= 5) break

      // Bot filter
      if (decision.filters.includes("bot")) {
        const author = pr.user?.login?.toLowerCase() ?? ""
        const isByBot =
          BOT_LOGINS.some((b) => author.includes(b.toLowerCase())) ||
          BOT_KEYWORDS.some((kw) => pr.title.toLowerCase().includes(kw))
        if (!isByBot) continue
      }

      const checks = await this.fetchGitHub<GitHubCheckRunsResponse>(
        `${GITHUB_API}/repos/${repo}/commits/${pr.head.sha}/check-runs`,
        headers,
        `checks for PR #${pr.number}`
      )

      // Failing filter
      if (decision.filters.includes("failing")) {
        const failing = checks?.check_runs.filter((c) => c.conclusion === "failure").length ?? 0
        if (failing === 0) continue
      }

      // Mergeable filter
      if (decision.filters.includes("mergeable")) {
        if (pr.mergeable_state !== "clean" && pr.mergeable_state !== "unstable") continue
        const failing = checks?.check_runs.filter((c) => c.conclusion === "failure").length ?? 0
        if (failing > 0) continue
      }

      results.push({ repoFullName: repo, pr, checks })
    }

    return results
  }

  // ── Snapshot Fetch ───────────────────────────────────────

  private async snapshotFetch(
    decision: RouterDecision,
    headers: Record<string, string>,
    myLogin: string
  ): Promise<string | null> {
    const repo = decision.repo!

    const [openPRs, assignedPRs, issues, commits, milestones] = await Promise.all([
      this.fetchGitHub<GitHubPullRequest[]>(
        `${GITHUB_API}/repos/${repo}/pulls?state=open&per_page=10&sort=updated&direction=desc`,
        headers,
        `open PRs in ${repo}`
      ),
      this.fetchGitHub<GitHubPullRequest[]>(
        `${GITHUB_API}/repos/${repo}/pulls?state=open&assignee=${myLogin}&per_page=5&sort=updated`,
        headers,
        `assigned PRs in ${repo}`
      ),
      this.fetchGitHub<GitHubIssue[]>(
        `${GITHUB_API}/repos/${repo}/issues?state=open&per_page=5&sort=updated&direction=desc`,
        headers,
        `open issues in ${repo}`
      ),
      this.fetchGitHub<GitHubCommit[]>(
        `${GITHUB_API}/repos/${repo}/commits?per_page=5`,
        headers,
        `commits in ${repo}`
      ),
      this.fetchGitHub<GitHubMilestone[]>(
        `${GITHUB_API}/repos/${repo}/milestones?state=open&per_page=3&sort=due_on`,
        headers,
        `milestones in ${repo}`
      ),
    ])

    const sections: string[] = []

    // Open PRs
    if (openPRs && openPRs.length > 0) {
      const lines = await Promise.all(
        openPRs.slice(0, 5).map(async (pr) => {
          const checks = await this.fetchGitHub<GitHubCheckRunsResponse>(
            `${GITHUB_API}/repos/${repo}/commits/${pr.head.sha}/check-runs`,
            headers,
            `checks for PR #${pr.number}`
          )
          return this.formatPR({ repoFullName: repo, pr, checks })
        })
      )
      sections.push(`Open Pull Requests (${openPRs.length} total):\n${lines.join("\n\n")}`)
    }

    // Assigned PRs
    if (assignedPRs && assignedPRs.length > 0) {
      const lines = assignedPRs.map((pr) => {
        const assignees = pr.assignees?.map((a) => `@${a.login}`).join(", ") ?? "none"
        return `- **#${pr.number}**: ${pr.title} (assigned: ${assignees})`
      })
      sections.push(`Pull Requests Assigned to You:\n${lines.join("\n")}`)
    }

    // Issues
    if (issues && issues.length > 0) {
      const lines = issues.map((issue) => this.formatIssue(issue))
      sections.push(`Open Issues (${issues.length} shown):\n${lines.join("\n")}`)
    }

    // Commits
    if (commits && commits.length > 0) {
      const lines = commits.map((commit) => this.formatCommit(commit))
      sections.push(`Recent Commits on main:\n${lines.join("\n")}`)
    }

    // Milestones
    if (milestones && milestones.length > 0) {
      const lines = milestones.map((m) => this.formatMilestone(m))
      sections.push(`Open Milestones:\n${lines.join("\n")}`)
    }

    if (sections.length === 0) {
      console.log("[GitHub] Snapshot empty for", repo)
      return null
    }

    return `Recent activity snapshot for \`${repo}\`:\n\n${sections.join("\n\n")}`
  }

  // ── Formatters ───────────────────────────────────────────

  private formatPR(found: {
    repoFullName: string
    pr: GitHubPullRequest
    checks: GitHubCheckRunsResponse | null
  }): string {
    const { pr, checks } = found
    const stateEmoji = pr.draft ? "📝 Draft" : pr.state === "open" ? "🟢 Open" : "🟣"
    const ciStatus = this.formatChecks(checks)
    const bodySnippet = pr.body ? truncate(stripHtml(pr.body), 200) : "No description."
    const files =
      pr.changed_files > 0
        ? `(${pr.changed_files} files, +${pr.additions}/-${pr.deletions})`
        : ""
    const assignees = pr.assignees?.length
      ? `assigned: ${pr.assignees.map((a) => `@${a.login}`).join(", ")}`
      : ""

    return (
      `- ${stateEmoji} **#${pr.number}**: ${pr.title}\n` +
      `  Author: @${pr.user?.login ?? "unknown"} | ${files} | ${ciStatus}` +
      (assignees ? ` | ${assignees}` : "") +
      `\n  ${bodySnippet}\n  Link: ${pr.html_url}`
    )
  }

  private formatChecks(checks: GitHubCheckRunsResponse | null): string {
    if (!checks || checks.total_count === 0) return "CI: —"
    const passing = checks.check_runs.filter((c) => c.conclusion === "success").length
    const failing = checks.check_runs.filter((c) => c.conclusion === "failure").length
    const pending = checks.check_runs.filter((c) => c.status !== "completed").length
    if (failing > 0) return `❌ ${failing}/${checks.total_count} failing`
    if (pending > 0) return `⏳ ${pending}/${checks.total_count} pending`
    return `✅ ${passing}/${checks.total_count} passing`
  }

  private formatIssue(issue: GitHubIssue): string {
    const labels = issue.labels?.length ? ` [${issue.labels.map((l) => l.name).join(", ")}]` : ""
    return `- **#${issue.number}**: ${issue.title}${labels} (${relativeTime(issue.updated_at)})`
  }

  private formatCommit(commit: GitHubCommit): string {
    const msg = truncate(commit.commit.message.split("\n")[0], 60)
    const author = commit.author?.login ?? commit.commit.author.name
    return `- \`${msg}\` — @${author} (${relativeTime(commit.commit.author.date)})`
  }

  private formatMilestone(milestone: GitHubMilestone): string {
    const total = milestone.open_issues + milestone.closed_issues
    const pct = total > 0 ? Math.round((milestone.closed_issues / total) * 100) : 0
    const due = milestone.due_on ? `due ${relativeTime(milestone.due_on)}` : "no due date"
    return `- **${milestone.title}**: ${milestone.open_issues} open / ${milestone.closed_issues} closed (${pct}%) — ${due}`
  }

  // ── Helpers ──────────────────────────────────────────────

  private async fetchPR(
    repoFullName: string,
    number: number,
    headers: Record<string, string>
  ): Promise<{ repoFullName: string; pr: GitHubPullRequest; checks: GitHubCheckRunsResponse | null } | null> {
    const pr = await this.fetchGitHub<GitHubPullRequest>(
      `${GITHUB_API}/repos/${repoFullName}/pulls/${number}`,
      headers,
      `PR #${number}`
    )
    if (!pr) return null

    const checks = await this.fetchGitHub<GitHubCheckRunsResponse>(
      `${GITHUB_API}/repos/${repoFullName}/commits/${pr.head.sha}/check-runs`,
      headers,
      `checks for PR #${number}`
    )

    return { repoFullName, pr, checks }
  }

  private async getCachedRepos(
    login: string,
    headers: Record<string, string>,
    userId: string
  ): Promise<string[]> {
    const cacheKey = `github:repos:${userId}`
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        console.log("[GitHub] Using cached repo list")
        return JSON.parse(cached) as string[]
      }
    } catch {
      // ignore cache errors
    }

    const repos: string[] = []
    const myRepos = await this.fetchGitHub<GitHubRepo[]>(
      `${GITHUB_API}/users/${login}/repos?type=owner&sort=pushed&per_page=50`,
      headers,
      "user repos"
    )
    if (myRepos) {
      repos.push(...myRepos.map((r) => r.name))
    }

    try {
      await redis.setex(cacheKey, REPO_CACHE_TTL, JSON.stringify(repos))
    } catch {
      // ignore cache write errors
    }

    return repos
  }

  private async findSenderGitHub(
    email: IncomingEmail,
    headers: Record<string, string>,
    parts: string[]
  ): Promise<string | null> {
    if (!email.senderName) return null

    const nameQuery = encodeURIComponent(`fullname:"${email.senderName}" type:user`)
    console.log("[GitHub] Searching users by name:", sanitizeForLog(email.senderName ?? "", 40))
    let senderLogin = await this.trySearchUser(nameQuery, headers, parts)

    if (!senderLogin && email.senderEmail) {
      const emailLocal = email.senderEmail.split("@")[0]
      if (emailLocal && emailLocal.length >= 2) {
        const emailQuery = encodeURIComponent(`${emailLocal} in:email type:user`)
        console.log("[GitHub] Searching users by email local:", sanitizeForLog(emailLocal, 40))
        senderLogin = await this.trySearchUser(emailQuery, headers, parts)
      }
    }

    console.log("[GitHub] Sender match:", senderLogin ?? "NOT FOUND")
    return senderLogin
  }

  private async trySearchUser(
    query: string,
    headers: Record<string, string>,
    parts: string[]
  ): Promise<string | null> {
    try {
      const res = await fetch(`${GITHUB_API}/search/users?q=${query}&per_page=3`, { headers })
      if (!res.ok) return null
      const data = (await res.json()) as {
        items?: Array<{
          login: string
          name: string | null
          company: string | null
          bio: string | null
        }>
      }
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
        parts.push(`Sender's GitHub orgs: ${senderOrgs.map((o) => o.login).join(", ")}`)
      }

      return login
    } catch {
      return null
    }
  }

  private async fetchGitHub<T>(
    url: string,
    headers: Record<string, string>,
    label?: string
  ): Promise<T | null> {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) {
        if (label) console.log(`[GitHub] ${label}: HTTP ${res.status}`)
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      if (label) console.log(`[GitHub] ${label}: fetch error`, err)
      return null
    }
  }
}
