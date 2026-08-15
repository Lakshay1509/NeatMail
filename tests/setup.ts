import { mock, beforeEach, afterEach } from "bun:test";

// Must be first: lib modules that read env in their module body are imported below.
import "./helpers/test-env";

// Imported FIRST: it captures the real lib/gmail and lib/outlook (over mocked SDKs)
// before the wrapper doubles below replace them. See helpers/real-providers.ts.
import "./helpers/real-providers";
import { db, resetPrismaMock } from "./helpers/prisma-mock";
import { FakeRedis, resetRedis, clearLuaScripts } from "./helpers/redis-mock";
import { clerkServerModule, resetClerk } from "./helpers/clerk-mock";
import { queueModule, resetQueues } from "./helpers/queue-mock";
import { emailModule, resetEmails } from "./helpers/email-mock";
import { FakeDodoPayments, resetDodo, resetFetchMock } from "./helpers/dodo-mock";
import {
  gmailModule,
  outlookModule,
  supabaseModule,
  resetProviders,
} from "./helpers/provider-mock";
import { resetTransports } from "./helpers/transport-mock";

/**
 * Preloaded by bunfig.toml before every test file.
 *
 * Two jobs: give the process a deterministic env, and swap out the four things that
 * would otherwise open a socket the moment a lib module is imported — Postgres, Redis,
 * Clerk and BullMQ. `mock.module` has to run here rather than in a test file because
 * `import` statements hoist above everything, and lib/prisma.ts dials Postgres at
 * import time.
 */

// ── Infrastructure mocks ─────────────────────────────────────────────────────

// Postgres. lib/prisma.ts constructs a PrismaPg adapter on import, so this must be
// mocked or every `import { db }` opens a pool against a database that isn't there.
mock.module("@/lib/prisma", () => ({ db }));

// Redis. Mocked at the driver level rather than at lib/redis.ts, so lib/rate-limit.ts
// (which builds its own `new Redis(...)`) gets the fake too and its sliding-window
// arithmetic stays under test.
mock.module("ioredis", () => ({ default: FakeRedis, Redis: FakeRedis }));

// Clerk. `auth()` is the entry point of nearly every route handler.
mock.module("@clerk/nextjs/server", () => clerkServerModule);

// BullMQ. Records enqueues instead of scheduling them.
mock.module("@/lib/queue", () => queueModule);

// DodoPay. Mocked globally rather than per-file because lib/referral.ts imports the
// checkout route for the client, so the SDK is reachable from more places than the
// billing tests — and no test should ever construct a real payments client.
mock.module("dodopayments", () => ({
  default: FakeDodoPayments,
  DodoPayments: FakeDodoPayments,
}));

// Mail providers. Shared rather than per-file: several modules under test import from
// these, and two files mocking the same module with different export sets would fight.
// The archive/trash tests load the REAL modules via loadRealGmail/loadRealOutlook.
mock.module("@/lib/gmail", () => gmailModule);
mock.module("@/lib/outlook", () => outlookModule);
mock.module("@/lib/supabase", () => supabaseModule);

// The provider SDKs are already mocked by helpers/real-providers, which has to do it
// before importing the real wrappers. Nothing to repeat here.

// The classification and draft services, reached over HTTP by the delete-user cron.
mock.module("@/lib/draft", () => ({
  deleteUser: mock(async () => ({ vectors_deleted: 0 })),
  getDraftContext: mock(async () => ({})),
}));
mock.module("@/lib/model", () => ({
  deleteUser: mock(async () => ({ status: "ok" })),
  classifyEmail: mock(async () => ({})),
}));

// Outbound side effects no test should ever perform for real.
mock.module("@/lib/resend", () => emailModule);
// cron.ts constructs the Resend SDK directly rather than going through lib/resend.
mock.module("resend", () => ({
  Resend: class {
    emails = { send: mock(async () => ({ data: { id: "email_1" }, error: null })) };
  },
}));
mock.module("@/lib/posthog-server", () => ({
  getPostHogClient: () => ({
    capture: mock(() => undefined),
    identify: mock(() => undefined),
    shutdown: mock(async () => undefined),
  }),
  shutdownPostHog: mock(async () => undefined),
}));

// ── Console ──────────────────────────────────────────────────────────────────
// Several modules log deliberately on their rejection paths (referral guards, archive
// sweep failures), and those paths are exactly what the tests drive — so a clean run
// would otherwise bury the results in expected noise. `TEST_VERBOSE=1` brings it back
// when you're debugging a specific failure.

if (process.env.TEST_VERBOSE !== "1") {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = () => {};
  }
}

// ── Per-test isolation ───────────────────────────────────────────────────────
// Every fake is stateful. Resetting in both hooks means a test that throws midway
// still can't leak a programmed return value into the next one.

function resetAll() {
  resetPrismaMock();
  resetRedis();
  resetClerk();
  resetQueues();
  resetEmails();
  resetDodo();
  resetFetchMock();
  resetProviders();
  resetTransports();
  clearLuaScripts();
}

beforeEach(resetAll);
afterEach(resetAll);
