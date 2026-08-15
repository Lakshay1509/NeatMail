# Tests

Runner: **`bun test`** — no extra dependencies. Bun is already the package manager, runs
TypeScript and the `@/*` alias natively, and ships `mock.module`, which is what makes it
possible to swap out Prisma and Redis before a `lib/` module dials them at import time.

```bash
bun test                          # everything
bun test tests/unit/tiers.test.ts # one file
bun test --watch                  # watch mode
bun test -t "sumMailboxAddons"    # by test name
bun test --coverage               # coverage report
TEST_VERBOSE=1 bun test           # un-silence the app's own console output
```

Type checking is a separate pass: `bun run type-check` runs the app config, then
`tests/tsconfig.json`. Tests are excluded from the root config so `@types/bun`'s globals
(notably its `fetch`, which carries a `preconnect` the DOM's does not) don't leak into
the app build and break `lib/hono.ts`.

## Layout

```
tests/
  setup.ts             preloaded by bunfig.toml — module mocks + per-test reset
  helpers/
    test-env.ts        process.env, imported first (lib/openai reads it at import time)
    real-providers.ts  captures the REAL lib/gmail + lib/outlook before they're doubled
    transport-mock.ts  googleapis + Microsoft Graph SDK doubles
    prisma-mock.ts     lazily-built Prisma double, one Bun mock per db.<model>.<method>
    redis-mock.ts      in-memory ioredis (strings, hashes, sorted sets, multi, eval)
    clerk-mock.ts      settable auth() identity + brokered OAuth tokens
    provider-mock.ts   lightweight lib/gmail + lib/outlook + lib/supabase doubles
    queue-mock.ts      BullMQ double that records enqueues instead of scheduling them
    email-mock.ts      lib/resend double that records sends
    dodo-mock.ts       DodoPay SDK double + raw-fetch interceptor
    api.ts             mounts a Hono sub-router and drives it over real Requests
  unit/                lib/ modules
  api/                 app/api/[[...route]]/ handlers
```

### Import order in setup.ts is load-bearing

Three things must happen in this order, and the imports at the top of `setup.ts` are what
enforce it (ES imports evaluate before any statement in the module body):

1. **`helpers/test-env`** — `lib/openai.ts` builds its client in the module body and
   throws without `OPENAI_API_KEY`, so env must exist before any `lib/` module loads.
2. **`helpers/real-providers`** — mocks `googleapis` and the Graph SDK, *then* imports
   `lib/gmail.ts` and `lib/outlook.ts` for real and captures each export into its own
   binding.
3. **the rest of `setup.ts`** — which replaces `@/lib/gmail` and `@/lib/outlook` with the
   lightweight doubles for every other test file.

That is how `unit/gmail-archive.test.ts` and `unit/outlook-archive.test.ts` exercise the
genuine batching, bad-id fallback and move-vs-delete logic while `unit/archive-rules.test.ts`
still gets a one-line double it can program. Do not convert the dynamic imports in
`real-providers.ts` to static ones — they would hoist above the `mock.module` calls and
the real SDKs would load instead of the fakes.

One consequence worth knowing: two classes named `OAuthError` exist in the process (the
real one and the double's), so those tests assert on `error.name`, not `instanceof`.

## How the mocking works

`bunfig.toml` preloads `tests/setup.ts` before any test file. That ordering matters:
`import` statements hoist above everything in a module, and `lib/prisma.ts` constructs a
Postgres adapter the moment it's imported. Installing the mocks in a preload is the only
way to get in front of that.

Mocked globally in `setup.ts`:

| Module                  | Replaced with                                            |
| ----------------------- | -------------------------------------------------------- |
| `@/lib/prisma`          | Bun mocks per model method, with shape-correct defaults   |
| `ioredis`               | `FakeRedis` — a working in-memory implementation          |
| `@clerk/nextjs/server`  | `auth()` returning whatever `setAuthUser()` was given     |
| `@/lib/queue`           | queues that record `add()` calls                          |
| `@/lib/resend`          | senders that record their arguments                       |
| `@/lib/posthog-server`  | no-op capture                                             |
| `dodopayments`          | SDK double; `dodo.*` in `helpers/dodo-mock.ts`            |

DodoPay is mocked globally because `lib/referral.ts` imports the checkout route for its
client, putting the SDK on more import paths than the billing tests alone. The REST calls
that bypass the SDK (resume, cancel/renew) go through `installFetchMock()` instead.

Redis is mocked at the **driver** level rather than at `lib/redis.ts`, so `lib/rate-limit.ts`
— which builds its own `new Redis(...)` — gets the fake too and its sliding-window
arithmetic stays under test rather than being stubbed away.

Heavier or test-specific modules (`@/lib/gmail`, `@/lib/outlook`, `@/lib/payement`,
`standardwebhooks`) are mocked in the file that needs them, using `mock.module(...)`
followed by `await import(...)` — a static import would hoist above the mock and defeat
it. See `tests/unit/archive-rules.test.ts` for the pattern.

Every fake is reset in both `beforeEach` and `afterEach`, so a test that throws midway
can't leak a programmed return value into the next one.

### `mock.module` is process-global — the one real footgun

Bun runs every test file in one process, and `mock.module` replaces a module for the
**whole run**, not just the file that called it. A file-local mock of a module that
another file exercises for real will silently break that other file, and only when they
run together — each still passes on its own.

This has now bitten twice, both times in `tests/api/dodo-webhook.test.ts`:

| Mocked there | Broke | Cost |
| --- | --- | --- |
| `@/lib/referral` | `unit/referral.test.ts` | 16 assertions |
| `@/lib/payement` | `unit/payement.test.ts` | 43 assertions |

Both fixes were the same: stop mocking the shared module, and assert through its first
observable effect instead (`db.referral.findFirst`, `db.subscription.upsert`, …). That
exercises the real wiring rather than a stub of it, so it is a better test anyway.

**The rule:**

1. If a module is imported by more than one test file, mock it **once in `setup.ts`**
   with every export any of them needs. That is why `@/lib/gmail`, `@/lib/outlook`,
   `@/lib/supabase` and `dodopayments` live there rather than in the files that use them.
2. Only `mock.module` locally for a module **no other test file touches** — currently
   just `standardwebhooks` and `@/lib/trial-reminder`.
3. Otherwise, assert through observable effects.

After adding any file-local module mock, check order-independence:

```bash
bun test path/to/new.test.ts path/to/other.test.ts
bun test path/to/other.test.ts path/to/new.test.ts
```

Both orders must match running each file alone. A quick full check:

```bash
for f in $(find tests -name "*.test.ts"); do bun test "$f" | tail -3; done
```

## Writing a unit test

Program only the calls the code under test actually makes; everything else already
returns a sane default (`findMany` → `[]`, `findUnique` → `null`, `updateMany` →
`{ count: 0 }`).

```ts
import { describe, expect, it } from "bun:test";
import { getUserTier } from "@/lib/tier-guard";
import { db } from "../helpers/prisma-mock";

it("reads a member's tier off the org admin", async () => {
  db.organizationMember.findUnique.mockResolvedValue({
    organization: { created_by: "user_admin", members: [{ user_id: "user_admin" }] },
  });
  db.user_tokens.findUnique.mockResolvedValue({ tier: "MAX" });

  expect(await getUserTier("user_member")).toBe("MAX");
});
```

## Writing an API test

`mountRouter` mounts one Hono sub-router under `/api`, exactly as
`app/api/[[...route]]/route.ts` does, and drives it with real `Request` objects. It
deliberately does not load `route.ts`: that file imports all 25 routers plus Bull Board,
so pulling it in to test one endpoint drags in the whole app. The rate-limit middleware
it applies is covered directly in `tests/unit/rate-limit.test.ts`.

```ts
import referral from "@/app/api/[[...route]]/referral";
import { mountRouter } from "../helpers/api";
import { setAuthUser } from "../helpers/clerk-mock";

const api = mountRouter("/referral", referral);

it("403s for a non-admin team member", async () => {
  setAuthUser("user_member");
  db.organizationMember.findUnique.mockResolvedValue({
    organization: { created_by: "user_admin", members: [{ user_id: "user_admin" }] },
  });

  expect((await api.get("/referral/code")).status).toBe(403);
});
```

`api.get/post/patch/put/delete` accept `{ body, headers, cookies, query }` and return
`{ status, body, headers, raw }` with the body already JSON-parsed.

## Current coverage

| Area | File | What it pins down |
| --- | --- | --- |
| Pricing & plans | `unit/tiers.test.ts` | region → currency, product-id round trip, `sumMailboxAddons` returning `null` (never `0`) for an unreadable cart, MAX-only paid seats |
| Tier gating | `unit/tier-guard.test.ts` | tier resolving through the billing owner, FREE denial, at-limit vs under-limit |
| Org & billing owner | `unit/organization.test.ts` | admin selection, `haveEverSharedTeam` surviving a member leaving, detach semantics |
| Subscription state | `unit/subscription.test.ts` | trial vs card-trial vs paid branches, annual detection both ways, `trialEligible` |
| Referrals | `unit/referral.test.ts` | code minting under races, every rejection path, cap reservation and compensation |
| Archive rules | `unit/archive-rules.test.ts` | SEEDED date floor, AUTO category protection, partial-failure stamping |
| Rate limiting | `unit/rate-limit.test.ts` | identifier precedence, per-identifier and per-limiter isolation, window parsing |
| Throttling | `unit/throttle.test.ts` | token-bucket waits, per-user buckets, quota units, timeout behaviour |
| Crypto | `unit/encode.test.ts` | round trips, random nonce for tokens vs deterministic for domains, tamper rejection |
| Onboarding payload | `unit/onboard-payload.test.ts` | draft-prompt seeding and the generic-domain skip |
| Unsubscribe parsing | `unit/unsubscribe.test.ts` | nested multipart, base64url decoding, Outlook bare-URL fallback |
| **Webhook write path** | `unit/payement.test.ts` | the `extraMailboxes` omit-on-null guard, pause-never-detach seat capping, teardown ownership checks, chargeback vs refund, watch lifecycle |
| **Gmail archive/trash** | `unit/gmail-archive.test.ts` | archive removes INBOX and never adds TRASH, 1000-id batching, sequential batches for quota, bad-id fallback on 404/400 but not on 429/5xx |
| **Outlook archive** | `unit/outlook-archive.test.ts` | archive is a MOVE and never a DELETE, Archive-folder resolution, 404 counted as done, capped concurrency, `archivedIds` only ever holds what actually moved |
| API: checkout | `api/checkout.test.ts` | trial eligibility, resume-not-duplicate, seat caps, add-on carry-across, the two-currency split, `/onboard-complete` routing |
| API: Dodo webhook | `api/dodo-webhook.test.ts` | signature rejection, idempotency, event → handler routing, retryability on failure |
| API: cron | `api/cron.test.ts` | the shared `CRON_SECRET` gate on all 7 endpoints, irreversible user deletion, trial downgrade guarded by an active subscription |
| API: organization | `api/organization.test.ts` | invite claim race, seat cap inside the join transaction, ex-admin member release, detach-on-leave, pause vs remove, invite revocation limited to unclaimed invites |
| API: geo | `api/geo.test.ts` | `cf-ipcountry` → billing region |
| API: referral | `api/referral.test.ts` | 401/403 gates, pagination cursor, zod query validation |
| API: health | `api/health.test.ts` | healthy / degraded / unhealthy status codes, liveness vs readiness |

### Known gaps documented by tests

Two tests assert current behaviour rather than desired behaviour. Both are named so they
surface in `bun test` output; if either is fixed, flip the assertion and rename it.

**`api/organization.test.ts` — "NOTE: a padded email is rejected by validation before the
route can trim it".** `POST /invite` does `body.email?.trim()`, but `zValidator` runs
first and `z.string().email()` rejects surrounding whitespace, so the trim never applies.
An admin pasting an address with a trailing space gets a 400 instead of an invite. Fix:
`z.string().trim().email()` in the schema.

**`api/cron.test.ts` — "NOTE: /sendNewMails validates the body before checking auth".**
Same ordering property: `zValidator` is middleware, so an unauthenticated caller with a
bad body sees 400 rather than 401. No side effect either way; move the auth check into
middleware if unauthenticated callers should learn nothing about the schema.

### Behavioural gap documented by a test

`api/dodo-webhook.test.ts` has a test named **"KNOWN GAP: truly concurrent deliveries of
one id both process"**. It asserts current behaviour, not desired behaviour. The guard in
`dodo-webhook.ts` is `EXISTS` then `SETEX` — a check-then-set across two round trips — so
two simultaneous deliveries of the same `webhook-id` both pass the check before either
writes, and both process. The comment above it claims otherwise. The fix is an atomic
`SET NX` claim, exactly as `claimReferralReward` already does in `lib/redis.ts`; when that
lands, flip the assertion to `1` and rename the test.

## Adding to it

- **A new `lib/` module** — add `tests/unit/<module>.test.ts`. If it imports something
  heavy or network-bound, mock that module in the test file and `await import()` the
  module under test.
- **A new API route** — add `tests/api/<route>.test.ts` and `mountRouter("/<path>", router)`.
  Cover the auth gate, the happy path, and each validation rejection.
- **A new `send*Email` in `lib/resend.ts` or a new queue in `lib/queue.ts`** — add its name
  to the list in `helpers/email-mock.ts` / `helpers/queue-mock.ts`. Bun resolves a mocked
  module's named exports from the object's own keys, so a missing name fails loudly with
  `Export named 'x' not found in module`.

Nothing here touches Postgres, Redis, Clerk, DodoPay, Gmail or Outlook. If a test needs a
real credential, it has stopped being a unit test.
