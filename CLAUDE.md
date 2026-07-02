# Agent Guide — NeatMail

## Build & Dev
- **Package manager:** Bun. Use `bun install`, `bun run dev`, `bun run build`. Do not use npm/pnpm.
- **Dev server:** `bun run dev` → http://localhost:3000
- **Lint:** `bun run lint` (ESLint, Next.js vitals + TS configs)
- **Type check:** `bun run type-check` (`tsc --noEmit`)
- **Build:** `bun run build` runs `prisma generate && next build` automatically.
- **No tests exist** in this repo. Do not look for test commands.

## Architecture
- **Next.js 16.1** + React 19 app router. Frontend pages in `app/`. API is **Hono** mounted via `app/api/[[...route]]/route.ts` with `basePath("/api")`.
- **Auth:** Clerk (`@clerk/nextjs`). Middleware logic is in `proxy.ts` (not `middleware.ts`). Public API routes are explicitly allow-listed there.
- **Database:** PostgreSQL via Prisma. Client is generated to a **custom output path**: `prisma/generated/prisma` and imported as `@/prisma/generated/prisma/client`.
- **Background jobs:** BullMQ. Queue definitions in `lib/queue.ts`, workers in `bullmq/workers/`. Dashboard at `/api/bullboard` (Bull Board).
- **Rate limiting:** Custom Redis-based sliding-window limiter in `lib/rate-limit.ts`.
- **AI drafts:** `context-engine/pipeline.ts` assembles context cards (calendar providers) and calls Azure OpenAI (`gpt-5-mini`).
- **External APIs:**
  - Classification API (`lib/model.ts`) — `CLASSIFICATION_API_URL`
  - Draft context API (`lib/draft.ts`) — `DRAFT_API_URL`
  Both use `AUTHORIZATION_KEY` header.

## Prisma
- Schema: `prisma/schema.prisma`
- Config: `prisma.config.ts` (loads `.env.local` in non-production)
- **Always regenerate after schema changes:** `bunx prisma generate`
- Migrations run via GitHub Actions on merge to `main` (`.github/workflows/migrate.yml`).
- Local setup: `cp .env.example .env.local`, fill values, then `bunx prisma db push && bunx prisma generate` (one-time only).
- **NEVER run `bunx prisma db push` after initial setup.** Schema changes must go through `bunx prisma generate` locally; migrations are applied via GitHub Actions on merge to `main`.

## Style & UI
- **Tailwind CSS v4** with `@tailwindcss/postcss`. Config is in `postcss.config.mjs`; no separate `tailwind.config.ts`.
- **shadcn/ui** (New York style). Aliases map to `@/components/ui`, `@/lib`, `@/hooks`.
- Global styles: `app/globals.css`.

## Important Constraints
- **Docker build skips type checking** (`typescript: { ignoreBuildErrors: true }` in `next.config.ts`) because `tsc` spawns a worker that uses ~1.5GB RAM — fatal on the 4GB VPS target. Run `tsc --noEmit` locally or in CI instead.
- **Docker memory caps:** Build uses `NODE_OPTIONS=--max-old-space-size=1536`, runtime uses `768`.
- `output: "standalone"` is set for Docker/VPS deployment.

## Pricing & Tiers

### Tiers

| Tier | Monthly | Annual | Features |
|---|---|---|---|
| **Free** | — | — | 100 tracked emails, 3 custom labels, no AI drafts, no digest, no integrations |
| **Pro** | $9 / ₹299 | $90 / ₹2,499 | Unlimited emails/labels, 20 AI drafts/mo, 5 archive rules, digest, follow-ups, Telegram & Slack |
| **Max** | $15 / ₹499 | $150 / ₹4,990 | Unlimited everything, advanced analytics, priority support |

### Region-aware pricing

- **Detection:** `cf-ipcountry` header (Cloudflare). India users get INR prices; all others get USD prices.
- **Env vars:** 8 DodoPay product IDs — 2 tiers (PRO, MAX) × 2 intervals (monthly, annual) × 2 regions (IN, GLOBAL). See `.env.example` for the full list.
- **Backend:** `lib/tiers.ts` — `getProductId(tier, country, interval)` maps region to the correct DodoPay product. `getTierPrices(region)` returns the price constants for UI display.
- **Frontend:** `features/geo/use-geo.ts` fetches region from `GET /api/geo`. Components use `getTierPrices(region)` for `{ symbol, currency, monthly, annual }`.
- **Checkout:** All checkout endpoints read `cf-ipcountry` and call `getProductId()` to select the correct DodoPay product. The DodoPay dashboard holds the actual prices.
- **Free trial:** 7 days of MAX-tier features. No region gating.

### Files

| File | Role |
|---|---|
| `lib/tiers.ts` | Tiers, limits, prices (USD + INR), product ID mapping, region helpers |
| `lib/tier-guard.ts` | Tier checks, feature access gating |
| `app/api/[[...route]]/geo.ts` | `GET /api/geo` → `{ region: "IN" \| "GLOBAL" }` |
| `features/geo/use-geo.ts` | Client hook for region detection |
| `components/Billing.tsx` | Billing page with region-aware tier cards |
| `components/SubscriptionModal.tsx` | Upsell modal with region-aware pricing table |
| `app/api/[[...route]]/checkout.ts` | Checkout, plan change, preview (all region-aware) |
| `lib/payement.ts` | DodoPay webhook handler, subscription tier assignment |
| `app/api/[[...route]]/freeTrial.ts` | Free trial activation |

## Env Setup
- Copy `.env.example` to `.env.local` and fill all values.
- Required infra: PostgreSQL, Redis, Clerk, BullMQ (Redis-backed), OpenAI/Azure, Google Cloud (Gmail/PubSub), Microsoft Entra (Outlook), DodoPay, Resend, Telegram Bot.

## Code Conventions
- Path alias `@/*` maps to root (`"./*"`).
- Hono sub-routers are imported and chained in `app/api/[[...route]]/route.ts`.
- BullMQ workers are plain async functions in `bullmq/workers/`; queue adapters are registered in `lib/queue.ts`.
- `lib/supabase.ts` is a misnomer — it contains Prisma-based DB helpers, not Supabase SDK usage.

## External Libraries & APIs
- **If you are not sure, search the web.** When adding or referencing third-party integrations, SDKs, or APIs (e.g., Slack, Stripe, OAuth providers), do not rely on memory or guesswork for package names, import paths, API endpoints, method signatures, or configuration options.
- Always verify references against official documentation or the latest SDK source. Incorrect package references or API URLs may cause runtime failures even if the surrounding logic is correct.
- Prefer official docs, READMEs, and registry pages (npm, PyPI, etc.) over assumed knowledge.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

# Google API Quota Reference for Agents

> **Project note:** This project was created **before May 1, 2026** and used the API between Nov 2025–Apr 2026.  
> It retains the **old (grandfathered) quota limits** — not the new post-May 2026 quotas.  
> Google will give at least 90 days' notice before migrating existing projects.

---

## Scopes in use

| Scope | Access level |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Read all Gmail resources and metadata |
| `https://www.googleapis.com/auth/gmail.labels` | Create, read, update, and delete labels only |
| `https://www.googleapis.com/auth/gmail.modify` | Read, compose, send, permanently delete threads/messages |
| `https://www.googleapis.com/auth/gmail.compose` | Create, read, update drafts and send messages |
| `https://www.googleapis.com/auth/calendar.readonly` | Read all calendar data |

---

## Gmail API

### Rate limits (grandfathered — old quotas)

| Limit type | Value | Per-second equivalent | Error on exceed |
|---|---|---|---|
| Per project / minute | 1,200,000 quota units | ~20,000 / sec | `rateLimitExceeded` |
| Per user / minute | 15,000 quota units | ~250 / sec | `userRateLimitExceeded` |
| Recipients per email | 500 max | — | — |

> **New project comparison (post May 1, 2026):** per-user drops to 6,000/min and `messages.get` costs 20 units (vs 5). Being grandfathered is a 4x advantage on read-heavy workloads.

### Quota units per method

All methods below are accessible with the scopes listed above.

| Method | Quota units | Scopes required | Type |
|---|---|---|---|
| `getProfile` | 1 | `readonly` | read |
| `labels.get` | 1 | `readonly`, `labels` | read |
| `labels.list` | 1 | `readonly`, `labels` | read |
| `history.list` | 2 | `readonly` | read |
| `labels.create` | 5 | `labels` | write |
| `labels.delete` | 5 | `labels` | write |
| `labels.patch` | 5 | `labels` | write |
| `labels.update` | 5 | `labels` | write |
| `messages.list` | 5 | `readonly` | read |
| `messages.get` | 5 | `readonly` | read |
| `messages.attachments.get` | 5 | `readonly` | read |
| `messages.modify` | 5 | `modify` | write |
| `messages.trash` | 5 | `modify` | write |
| `messages.untrash` | 5 | `modify` | write |
| `drafts.list` | 5 | `readonly`, `compose` | read |
| `drafts.get` | 5 | `readonly`, `compose` | read |
| `threads.list` | 10 | `readonly` | read |
| `threads.get` | 10 | `readonly` | read |
| `threads.modify` | 10 | `modify` | write |
| `threads.trash` | 10 | `modify` | write |
| `threads.untrash` | 10 | `modify` | write |
| `drafts.create` | 10 | `compose` | write |
| `drafts.delete` | 10 | `compose` | write |
| `drafts.update` | 15 | `compose` | write |
| `messages.delete` | 20 | `modify` | write |
| `threads.delete` | 20 | `modify` | write |
| `stop` | 50 | `readonly` | write |
| `messages.batchModify` | 50 | `modify` | write |
| `messages.batchDelete` | 50 | `modify` | write |
| `drafts.send` | 100 | `compose` | write ⚠️ |
| `messages.send` | 100 | `compose` | write ⚠️ |
| `watch` | 100 | `readonly` | write |

### Quick burn-rate reference

At the per-user limit of **15,000 units/min**:

| Operation | Units | Max calls/min |
|---|---|---|
| Read labels | 1 | 15,000 |
| List messages / threads | 5–10 | 1,500–3,000 |
| Get message body | 5 | 3,000 |
| Modify / trash message | 5 | 3,000 |
| Batch modify (up to 1,000 msgs per call) | 50 | 300 |
| Send email | 100 | 150 |

---

## Google Calendar API

### Rate limits (grandfathered — old quotas)

Calendar uses **raw request counts**, not quota units.  
Quotas are enforced on a **sliding window per minute**.

| Limit type | Value | Error on exceed |
|---|---|---|
| Per project / minute | ~2,400 requests | `rateLimitExceeded` (403 / 429) |
| Per user / minute | ~2,400 requests | `userRateLimitExceeded` (403) |
| Operational (per-calendar burst) | Unspecified — throttled dynamically | `quotaExceeded` (403) |

> A burst that exceeds the per-minute quota in one window is smoothed into the next window — requests are rate-limited, not failed outright.

### Methods available with your read-only scopes

| Method | Scope required | Type |
|---|---|---|
| `calendarList.list` | `calendar.readonly` | read |
| `calendarList.get` | `calendar.readonly` | read |
| `calendars.get` | `calendar.readonly` | read |
| `events.list` | `calendar.readonly` | read |
| `events.get` | `calendar.readonly` | read |
| `events.instances` | `calendar.readonly` | read |
| `events.watch` | `calendar.readonly` | write |
| `freebusy.query` | `calendar.readonly` | read |
| `settings.list` | `calendar.readonly` | read |
| `settings.get` | `calendar.readonly` | read |
| `colors.get` | `calendar.readonly` | read |

> ⚠️ With only `calendar.readonly`, agents **cannot** create, update, or delete events or calendars. Attempting to do so returns a `403 insufficientPermissions` error.

---

## Error handling

Both APIs return `403` or `429` on quota/rate limit errors. Always implement **exponential backoff**:

1. Catch the exception on a time-based error (403 `rateLimitExceeded` / 429)
2. Wait an initial delay (e.g. 1–2 seconds)
3. Retry, doubling the delay each time (1s → 2s → 4s → 8s → …)
4. Set a max retry limit (5–7 attempts) before surfacing the error
5. Add jitter (randomization) to avoid thundering-herd when multiple agents retry simultaneously

```
Gmail error codes:
  403 rateLimitExceeded       → project quota hit, wait 60s
  403 userRateLimitExceeded   → per-user quota hit, backoff
  429                         → same as above, treat identically

Calendar error codes:
  403 rateLimitExceeded       → backoff + retry
  403 userRateLimitExceeded   → backoff, consider splitting load across service accounts
  403 quotaExceeded           → hit general Calendar use limits
```

---

## Sources

- [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Calendar API quota management](https://developers.google.com/workspace/calendar/api/guides/quota)
- [Calendar API error handling](https://developers.google.com/workspace/calendar/api/guides/errors)
- [Google Workspace standardized model for agent tools and APIs](https://developers.google.com/workspace/guides/agent-tools-apis)
