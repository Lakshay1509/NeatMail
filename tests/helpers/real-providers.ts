import { mock } from "bun:test";

// Env first: lib/gmail pulls in lib/openai, which builds its client at import time.
import "./test-env";

import { googleapisModule, graphModule } from "./transport-mock";

/**
 * The genuine `lib/gmail.ts` and `lib/outlook.ts`, captured before setup.ts replaces them
 * with the lightweight doubles.
 *
 * Why this exists: most tests only care whether "archive" was called, so setup.ts mocks
 * the whole wrapper. But the archive/trash logic itself — batching, the bad-id fallback,
 * archive-vs-trash — is exactly the code that can destroy a user's mail, so it has to run
 * for real somewhere.
 *
 * The ordering is the entire trick, and it is load-bearing:
 *
 *   1. setup.ts imports this file, so it evaluates before any statement in setup.ts
 *      (ES imports hoist and evaluate first).
 *   2. Here, the provider SDKs are mocked FIRST, so the real wrappers imported below
 *      close over the fake `googleapis` / Graph client and can never reach the network.
 *   3. Each export is captured into its own binding, so setup.ts's later
 *      `mock.module("@/lib/gmail", …)` — which patches the module namespace — cannot
 *      swap these references out from under us.
 *
 * Do NOT convert the dynamic imports below into static ones: static imports hoist above
 * the `mock.module` calls, and the real SDKs would load instead of the fakes.
 */

mock.module("googleapis", () => googleapisModule);
mock.module("@microsoft/microsoft-graph-client", () => graphModule);

const gmailNs = await import("@/lib/gmail");
const outlookNs = await import("@/lib/outlook");

export const realGmail = {
  archiveGmailMessages: gmailNs.archiveGmailMessages,
  trashMessages: gmailNs.trashMessages,
  getGmailClient: gmailNs.getGmailClient,
  isOAuthRevokedError: gmailNs.isOAuthRevokedError,
  OAuthError: gmailNs.OAuthError,
};

export const realOutlook = {
  archiveMessagesOutlook: outlookNs.archiveMessagesOutlook,
  deleteOutlookMessage: outlookNs.deleteOutlookMessage,
  getGraphClient: outlookNs.getGraphClient,
  OAuthError: outlookNs.OAuthError,
};
