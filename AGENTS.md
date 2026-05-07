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
- **Background jobs:** Inngest. Functions live in `inngest/functions/`. They are registered in `app/api/inngest/route.ts`.
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
- Local setup: `bunx prisma db push` then `bunx prisma generate`.

## Style & UI
- **Tailwind CSS v4** with `@tailwindcss/postcss`. Config is in `postcss.config.mjs`; no separate `tailwind.config.ts`.
- **shadcn/ui** (New York style). Aliases map to `@/components/ui`, `@/lib`, `@/hooks`.
- Global styles: `app/globals.css`.

## Important Constraints
- **Docker build skips type checking** (`typescript: { ignoreBuildErrors: true }` in `next.config.ts`) because `tsc` spawns a worker that uses ~1.5GB RAM — fatal on the 4GB VPS target. Run `tsc --noEmit` locally or in CI instead.
- **Docker memory caps:** Build uses `NODE_OPTIONS=--max-old-space-size=1536`, runtime uses `768`.
- `output: "standalone"` is set for Docker/VPS deployment.

## Env Setup
- Copy `.env.example` to `.env.local` and fill all values.
- Required infra: PostgreSQL, Redis, Clerk, Inngest, OpenAI/Azure, Google Cloud (Gmail/PubSub), Microsoft Entra (Outlook), DodoPay, Resend, Telegram Bot.

## Code Conventions
- Path alias `@/*` maps to root (`"./*"`).
- Hono sub-routers are imported and chained in `app/api/[[...route]]/route.ts`.
- Inngest function files export a single `createFunction` result; registration happens in `app/api/inngest/route.ts`.
- `lib/supabase.ts` is a misnomer — it contains Prisma-based DB helpers, not Supabase SDK usage.
