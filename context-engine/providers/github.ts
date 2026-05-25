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
const FETCH_TIMEOUT_MS = 2000

// ── Types ──────────────────────────────────────────────────

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
  user: { login: string } | null
  assignees: Array<{ login: string }> | null
  head: { label: string; ref: string; sha: string }
  base: { label: string; ref: string; sha: string }
  created_at: string
  updated_at: string
  draft: boolean
  additions: number
  deletions: number
  changed_files: number
  mergeable_state: string
  labels: Array<{ name: string }>
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
  author: { login: string } | null
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
}

interface GitHubCheckRuns {
  total_count: number
  check_runs: Array<{ name: string; status: string; conclusion: string | null }>
}

// ── Utilities ──────────────────────────────────────────────

function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return ""
  return html.replace(/<[^>]*>?/gm, "").trim()
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max).trimEnd() + " ..."
}

function relativeTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return "just now"
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 2592000) return `${Math.floor(sec / 86400)}d ago`
  return `${Math.floor(sec / 2592000)}mo ago`
}

function isCommonWord(w: string): boolean {
  const s = new Set([
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
    "raise","pass","sell","sold","require","report","decide","pull","have","having",
    "being","been","was","were","being","having","done","gone","taken","made","seen",
    "known","come","thought","said","told","given","found","felt","become","left",
    "meant","kept","begun","shown","heard","stood","lost","paid","met","led",
    "understood","spoken","spent","grown","fallen","built","bought","written",
    "gotten","hidden","broken","chosen","drawn","driven","eaten","fallen","flown",
    "frozen","gotten","hidden","hit","held","hurt","kept","laid","led","left",
    "lent","let","lain","lit","lost","made","meant","met","misspelt","mistaken",
    "understood","overcome","overdone","overtaken","overthrown","paid","proven",
    "put","quit","read","rid","ridden","rung","risen","run","said","seen","sought",
    "sold","sent","set","sewn","shaken","shaved","shown","shrunk","shut","sung",
    "sunk","sat","slept","slid","slung","slit","smelt","sped","spelt","spent","spilt",
    "spun","spat","split","spoilt","spread","sprung","stood","stolen","stuck","stung",
    "struck","strung","sworn","swept","swollen","swum","swung","taken","taught","torn",
    "told","thought","thrown","understood","upset","woken","worn","woven","wed","wept",
    "wet","won","wound","withdrawn","wrung","written","that","those","these","this",
    "which","who","whom","whose","what","whatever","whoever","whomever","whichever",
    "where","wherever","when","whenever","why","how","however","whether","either",
    "neither","both","all","some","any","none","each","every","either","neither",
    "other","another","such","no","one","two","three","four","five","six","seven",
    "eight","nine","ten","first","second","third","last","next","previous","now","then",
    "today","tomorrow","yesterday","soon","later","early","late","already","still",
    "yet","ever","never","always","often","sometimes","usually","rarely","seldom",
    "once","twice","again","back","forward","together","apart","away","here","there",
    "everywhere","somewhere","nowhere","else","also","too","either","neither","only",
    "even","just","still","already","yet","quite","rather","pretty","fairly","almost",
    "nearly","hardly","barely","scarcely","seldom","maybe","perhaps","probably","possibly",
    "likely","surely","certainly","definitely","absolutely","completely","totally","entirely",
    "fully","partly","mostly","mainly","largely","partly","slightly","somewhat","kind of",
    "sort of","more","less","least","most","much","many","few","little","a lot","lots",
    "plenty","enough","several","various","certain","particular","specific","general",
    "usual","normal","regular","common","standard","typical","average","ordinary","special",
    "unique","different","same","similar","equal","equivalent","opposite","contrary",
  ])
  return s.has(w.toLowerCase())
}

function resolveRepo(
  text: string,
  myLogin: string,
  knownRepos: string[]
): string | null {
  const lower = text.toLowerCase()

  // Explicit owner/repo
  const m = text.match(/([\w.-]+\/[\w.-]+)/)
  if (m) return m[1]

  // Match against known repos
  for (const r of knownRepos) {
    if (lower.includes(r.toLowerCase())) return `${myLogin}/${r}`
  }

  // "X repo" / "repo X" pattern
  const ctx1 = lower.match(/(\b[\w-]{2,}\b)\s+(?:repo|repository)/)
  if (ctx1) {
    const c = ctx1[1]
    if (!isCommonWord(c) && c.length >= 3) return `${myLogin}/${c}`
  }
  const ctx2 = lower.match(/(?:repo|repository)\s+(\b[\w-]{2,}\b)/)
  if (ctx2) {
    const c = ctx2[1]
    if (!isCommonWord(c) && c.length >= 3) return `${myLogin}/${c}`
  }

  // "the repo" / "our repo" / "my repo" → use most recent
  if (/\b(the|our|my|this)\s+repo\b/.test(lower)) return null

  return null
}

function isValidRepoSlug(slug: string): boolean {
  const p = slug.split("/")
  if (p.length !== 2) return false
  const [owner, repo] = p
  if (!owner || !repo) return false
  if (owner.length > 39 || repo.length > 100) return false
  const rx = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/
  return rx.test(owner) && rx.test(repo)
}

// ── Provider ───────────────────────────────────────────────

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
    _entities: EmailEntities,
    userId: string
  ): Promise<ContextCard | null> {
    const text = `${email.subject} ${stripHtml(email.body)}`

    // ── 1. Auth ─────────────────────────────────────
    const auth = await this.authenticate(userId)
    if (!auth) return null
    const { headers, profile } = auth

    const parts: string[] = [
      `Your GitHub profile: @${profile.login}` +
        (profile.name ? ` (${profile.name})` : "") +
        (profile.company ? ` — ${profile.company}` : "") +
        (profile.bio ? `\nBio: ${profile.bio}` : ""),
    ]

    // ── 2. Resolve repo ─────────────────────────────
    const knownRepos = await this.getCachedRepos(profile.login, headers, userId)
    let repo = resolveRepo(text, profile.login, knownRepos)
    if (!repo) {
      repo = knownRepos[0] ? `${profile.login}/${knownRepos[0]}` : null
    }

    if (!repo || !isValidRepoSlug(repo)) {
      console.log("[GitHub] No valid repo, returning profile only")
      return {
        providerId: this.id,
        providerName: this.name,
        relevance: "low",
        summary: `GitHub context:\n${parts.join("\n\n")}`,
        data: { profile },
      }
    }

    // ── 3. Tiered fetch (all in parallel, bounded timeouts) ─
    const prsPromise = this.fetchWithTimeout<GitHubPullRequest[]>(
      `${GITHUB_API}/repos/${repo}/pulls?state=open&per_page=10&sort=updated&direction=desc`,
      headers,
      "open PRs"
    )

    const mainCommitPromise = this.fetchWithTimeout<GitHubCommit[]>(
      `${GITHUB_API}/repos/${repo}/commits?sha=main&per_page=1`,
      headers,
      "main commit"
    )

    const issuesPromise = this.fetchWithTimeout<GitHubIssue[]>(
      `${GITHUB_API}/repos/${repo}/issues?state=open&per_page=5&sort=updated&direction=desc`,
      headers,
      "open issues"
    )

    const assignedPRsPromise = this.fetchWithTimeout<GitHubPullRequest[]>(
      `${GITHUB_API}/repos/${repo}/pulls?state=open&assignee=${profile.login}&per_page=5&sort=updated`,
      headers,
      "assigned PRs"
    )

    const milestonesPromise = this.fetchWithTimeout<GitHubMilestone[]>(
      `${GITHUB_API}/repos/${repo}/milestones?state=open&per_page=3&sort=due_on`,
      headers,
      "milestones"
    )

    const [openPRs, mainCommit, issues, assignedPRs, milestones] = await Promise.allSettled([
      prsPromise,
      mainCommitPromise,
      issuesPromise,
      assignedPRsPromise,
      milestonesPromise,
    ])

    const prs = openPRs.status === "fulfilled" ? openPRs.value : null
    const mainSha = mainCommit.status === "fulfilled" && mainCommit.value?.length
      ? mainCommit.value[0].sha
      : null

    // ── 4. PR check-runs (for top 2 PRs) ─────────────
    const prChecks: Map<number, GitHubCheckRuns> = new Map()
    if (prs && prs.length > 0) {
      const top2 = prs.slice(0, 2)
      const checkResults = await Promise.allSettled(
        top2.map((pr) =>
          this.fetchWithTimeout<GitHubCheckRuns>(
            `${GITHUB_API}/repos/${repo}/commits/${pr.head.sha}/check-runs`,
            headers,
            `checks #${pr.number}`
          )
        )
      )
      top2.forEach((pr, i) => {
        const r = checkResults[i]
        if (r.status === "fulfilled" && r.value) {
          prChecks.set(pr.number, r.value)
        }
      })
    }

    // ── 5. Main branch check-runs ────────────────────
    let mainChecks: GitHubCheckRuns | null = null
    if (mainSha) {
      mainChecks = await this.fetchWithTimeout<GitHubCheckRuns>(
        `${GITHUB_API}/repos/${repo}/commits/${mainSha}/check-runs`,
        headers,
        "main checks"
      )
    }

    // ── 6. Build sections (only if data exists) ──────
    const sections: string[] = []

    // PRs
    if (prs && prs.length > 0) {
      const lines = prs.slice(0, 5).map((pr) => this.formatPR(pr, prChecks.get(pr.number) ?? null))
      sections.push(`Open Pull Requests (${prs.length} total):\n${lines.join("\n\n")}`)
    }

    // Assigned PRs
    if (assignedPRs.status === "fulfilled" && assignedPRs.value && assignedPRs.value.length > 0) {
      const lines = assignedPRs.value.map((pr) => {
        const assigneeList = pr.assignees?.map((a) => `@${a.login}`).join(", ") ?? "none"
        return `- **#${pr.number}**: ${pr.title} (assigned: ${assigneeList})`
      })
      sections.push(`Pull Requests Assigned to You:\n${lines.join("\n")}`)
    }

    // Main branch health
    if (mainCommit.status === "fulfilled" && mainCommit.value?.length) {
      const c = mainCommit.value[0]
      const ci = this.formatChecks(mainChecks)
      sections.push(
        `Main Branch Health:\n- Latest: \`${truncate(c.commit.message.split("\n")[0], 60)}\` by @${c.author?.login ?? c.commit.author.name} (${relativeTime(c.commit.author.date)})\n- CI: ${ci}`
      )
    }

    // Issues
    if (issues.status === "fulfilled" && issues.value && issues.value.length > 0) {
      const lines = issues.value.map((issue) => {
        const labels = issue.labels?.length ? ` [${issue.labels.map((l) => l.name).join(", ")}]` : ""
        return `- **#${issue.number}**: ${issue.title}${labels} (${relativeTime(issue.updated_at)})`
      })
      sections.push(`Open Issues (${issues.value.length} shown):\n${lines.join("\n")}`)
    }

    // Milestones
    if (milestones.status === "fulfilled" && milestones.value && milestones.value.length > 0) {
      const lines = milestones.value.map((m) => {
        const total = m.open_issues + m.closed_issues
        const pct = total > 0 ? Math.round((m.closed_issues / total) * 100) : 0
        const due = m.due_on ? `due ${relativeTime(m.due_on)}` : "no due date"
        return `- **${m.title}**: ${m.open_issues} open / ${m.closed_issues} closed (${pct}%) — ${due}`
      })
      sections.push(`Open Milestones:\n${lines.join("\n")}`)
    }

    if (sections.length > 0) {
      parts.push(`Recent activity for \`${repo}\`:\n\n${sections.join("\n\n")}`)
    }

    // ── 7. Sender context ────────────────────────────
    const domain = email.senderEmail.split("@")[1]?.toLowerCase() ?? ""
    if (!["gmail.com","outlook.com","yahoo.com","hotmail.com","protonmail.com","icloud.com","aol.com","live.com","snyk.io","dependabot.com","github.com"].includes(domain)) {
      const senderLogin = await this.findSenderGitHub(email, headers, parts)
      if (senderLogin) console.log(`[GitHub] Sender: @${senderLogin}`)
    }

    return {
      providerId: this.id,
      providerName: this.name,
      relevance: sections.length > 0 ? "high" : "medium",
      summary: `GitHub context:\n${parts.join("\n\n")}`,
      data: { profile, repo },
    }
  }

  // ── Formatters ───────────────────────────────────────────

  private formatPR(pr: GitHubPullRequest, checks: GitHubCheckRuns | null): string {
    const stateEmoji = pr.draft ? "📝 Draft" : "🟢 Open"
    const ci = this.formatChecks(checks)
    const merge =
      pr.mergeable_state === "dirty"
        ? "❌ Conflicts"
        : pr.mergeable_state === "clean"
          ? "✅ Clean"
          : `⏳ ${pr.mergeable_state ?? "unknown"}`
    const files =
      pr.changed_files > 0
        ? `(${pr.changed_files} files, +${pr.additions}/-${pr.deletions})`
        : ""
    const assignees = pr.assignees?.length
      ? `assigned: ${pr.assignees.map((a) => `@${a.login}`).join(", ")}`
      : ""

    return (
      `- ${stateEmoji} **#${pr.number}**: ${pr.title}\n` +
      `  Author: @${pr.user?.login ?? "unknown"} | ${files}\n` +
      `  Merge: ${merge} | CI: ${ci}` +
      (assignees ? ` | ${assignees}` : "") +
      `\n  Link: ${pr.html_url}`
    )
  }

  private formatChecks(checks: GitHubCheckRuns | null): string {
    if (!checks || checks.total_count === 0) return "—"
    const passing = checks.check_runs.filter((c) => c.conclusion === "success").length
    const failing = checks.check_runs.filter((c) => c.conclusion === "failure").length
    const pending = checks.check_runs.filter((c) => c.status !== "completed").length
    if (failing > 0) return `❌ ${failing}/${checks.total_count} failing`
    if (pending > 0) return `⏳ ${pending}/${checks.total_count} pending`
    return `✅ ${passing}/${checks.total_count} passing`
  }

  // ── Auth ─────────────────────────────────────────────────

  private async authenticate(
    userId: string
  ): Promise<{ headers: Record<string, string>; profile: GitHubUser } | null> {
    try {
      const client = await clerkClient()
      const res = await client.users.getUserOauthAccessToken(userId, "github")
      const token = res.data[0]?.token
      if (!token) {
        console.log("[GitHub] No OAuth token")
        return null
      }

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "neatmail-context-engine",
      }

      const profile = await this.fetchWithTimeout<GitHubUser>(
        `${GITHUB_API}/user`,
        headers,
        "/user",
        3000
      )
      if (!profile) {
        console.log("[GitHub] Profile fetch failed")
        return null
      }

      return { headers, profile }
    } catch (err) {
      console.error("[GitHub] Auth error:", err)
      return null
    }
  }

  // ── Fetch with timeout ───────────────────────────────────

  private async fetchWithTimeout<T>(
    url: string,
    headers: Record<string, string>,
    label?: string,
    timeoutMs = FETCH_TIMEOUT_MS
  ): Promise<T | null> {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      if (label) console.log(`[GitHub] ${label}: timeout or error`, err)
      return null
    }
  }

  // ── Cached repo list ─────────────────────────────────────

  private async getCachedRepos(
    login: string,
    headers: Record<string, string>,
    userId: string
  ): Promise<string[]> {
    const key = `github:repos:${userId}`
    try {
      const cached = await redis.get(key)
      if (cached) return JSON.parse(cached) as string[]
    } catch {
      // ignore
    }

    const repos = await this.fetchWithTimeout<GitHubRepo[]>(
      `${GITHUB_API}/users/${login}/repos?type=owner&sort=pushed&per_page=50`,
      headers,
      "user repos",
      3000
    )
    const names = repos?.map((r) => r.name) ?? []

    try {
      await redis.setex(key, REPO_CACHE_TTL, JSON.stringify(names))
    } catch {
      // ignore
    }

    return names
  }

  // ── Sender lookup ──────────────────────────────────────────

  private async findSenderGitHub(
    email: IncomingEmail,
    headers: Record<string, string>,
    parts: string[]
  ): Promise<string | null> {
    if (!email.senderName) return null

    const q = encodeURIComponent(`fullname:"${email.senderName}" type:user`)
    let login = await this.searchUser(q, headers, parts)

    if (!login && email.senderEmail) {
      const local = email.senderEmail.split("@")[0]
      if (local && local.length >= 2) {
        login = await this.searchUser(
          encodeURIComponent(`${local} in:email type:user`),
          headers,
          parts
        )
      }
    }

    return login
  }

  private async searchUser(
    query: string,
    headers: Record<string, string>,
    parts: string[]
  ): Promise<string | null> {
    try {
      const res = await fetch(
        `${GITHUB_API}/search/users?q=${query}&per_page=3`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      )
      if (!res.ok) return null
      const data = (await res.json()) as {
        items?: Array<{ login: string; name: string | null; company: string | null; bio: string | null }>
      }
      if (!data.items?.length) return null

      const top = data.items[0]
      parts.push(
        `Sender on GitHub: @${top.login}` +
          (top.name ? ` (${top.name})` : "") +
          (top.company ? ` — ${top.company}` : "") +
          (top.bio ? `\nBio: ${top.bio}` : "")
      )
      return top.login
    } catch {
      return null
    }
  }
}
