import { mock, type Mock } from "bun:test";

/**
 * Doubles for the two provider SDKs themselves — `googleapis` and
 * `@microsoft/microsoft-graph-client` — as opposed to the `@/lib/gmail` and
 * `@/lib/outlook` wrappers around them.
 *
 * Mocking at this layer is what lets tests exercise the REAL archive/trash logic in those
 * wrappers (batching, bad-id fallback, move-vs-delete) while no request leaves the
 * process. Consumers that only care about "did archive get called" keep using the wrapper
 * doubles in provider-mock.ts.
 */

type AnyMock = Mock<(...args: any[]) => any>;

// ── Gmail (googleapis) ───────────────────────────────────────────────────────

/** A Gmail API error as googleapis surfaces it: the status lives on `code`. */
export function gmailError(code: number, message = `Gmail ${code}`) {
  return Object.assign(new Error(message), { code });
}

export const gmailApi = {
  users: {
    messages: {
      batchModify: mock(async () => ({ data: {} })) as AnyMock,
      modify: mock(async () => ({ data: {} })) as AnyMock,
      trash: mock(async () => ({ data: {} })) as AnyMock,
      untrash: mock(async () => ({ data: {} })) as AnyMock,
      get: mock(async () => ({ data: {} })) as AnyMock,
      list: mock(async () => ({ data: { messages: [] } })) as AnyMock,
      batchDelete: mock(async () => ({ data: {} })) as AnyMock,
    },
    labels: {
      list: mock(async () => ({ data: { labels: [] } })) as AnyMock,
      create: mock(async () => ({ data: { id: "Label_1" } })) as AnyMock,
    },
    watch: mock(async () => ({ data: { historyId: "1" } })) as AnyMock,
    stop: mock(async () => ({ data: {} })) as AnyMock,
    getProfile: mock(async () => ({ data: { emailAddress: "a@b.c" } })) as AnyMock,
  },
};

/** Credentials handed to `oauth2Client.setCredentials`, for asserting token plumbing. */
export const oauthCredentials: unknown[] = [];

class FakeOAuth2 {
  setCredentials(creds: unknown) {
    oauthCredentials.push(creds);
  }
}

export const googleapisModule = {
  google: {
    auth: { OAuth2: FakeOAuth2 },
    gmail: () => gmailApi,
    calendar: () => ({ events: { list: mock(async () => ({ data: { items: [] } })) } }),
  },
};

// ── Outlook (Microsoft Graph) ────────────────────────────────────────────────

/** A Graph error: the status lives on `statusCode`. */
export function graphError(statusCode: number, message = `Graph ${statusCode}`) {
  return Object.assign(new Error(message), { statusCode });
}

export interface GraphCall {
  path: string;
  method: "get" | "post" | "patch" | "delete";
  body?: unknown;
}

/** Every Graph request issued, in order. */
export const graphCalls: GraphCall[] = [];

type GraphHandler = (call: GraphCall) => unknown | Promise<unknown>;

let graphHandler: GraphHandler = (call) => {
  // The archive path resolves the well-known Archive folder before moving anything.
  if (call.method === "get" && call.path === "/me/mailFolders/archive") {
    return { id: "folder_archive", displayName: "Archive" };
  }
  return {};
};

/** Replaces the Graph responder. Throw from it to simulate a Graph failure. */
export function setGraphHandler(fn: GraphHandler): void {
  graphHandler = fn;
}

/** Requests matching a path substring (and optionally a method). */
export function graphCallsFor(
  pathFragment: string,
  method?: GraphCall["method"],
): GraphCall[] {
  return graphCalls.filter(
    (call) =>
      call.path.includes(pathFragment) && (!method || call.method === method),
  );
}

function makeRequest(path: string) {
  const run = (method: GraphCall["method"]) => async (body?: unknown) => {
    const call: GraphCall = { path, method, ...(body !== undefined ? { body } : {}) };
    graphCalls.push(call);
    return graphHandler(call);
  };
  return {
    get: run("get"),
    post: run("post"),
    patch: run("patch"),
    delete: run("delete"),
    // Graph's fluent builders — chainable no-ops so query-building code still runs.
    select: () => makeRequest(path),
    filter: () => makeRequest(path),
    top: () => makeRequest(path),
    orderby: () => makeRequest(path),
    expand: () => makeRequest(path),
    header: () => makeRequest(path),
  };
}

export const graphClient = { api: (path: string) => makeRequest(path) };

export const graphModule = {
  Client: {
    init: (_options?: unknown) => graphClient,
    initWithMiddleware: (_options?: unknown) => graphClient,
  },
};

// ── Reset ────────────────────────────────────────────────────────────────────

const GMAIL_DEFAULTS: [AnyMock, () => any][] = [
  [gmailApi.users.messages.batchModify, () => ({ data: {} })],
  [gmailApi.users.messages.modify, () => ({ data: {} })],
  [gmailApi.users.messages.trash, () => ({ data: {} })],
  [gmailApi.users.messages.untrash, () => ({ data: {} })],
  [gmailApi.users.messages.get, () => ({ data: {} })],
  [gmailApi.users.messages.list, () => ({ data: { messages: [] } })],
  [gmailApi.users.messages.batchDelete, () => ({ data: {} })],
  [gmailApi.users.labels.list, () => ({ data: { labels: [] } })],
  [gmailApi.users.labels.create, () => ({ data: { id: "Label_1" } })],
  [gmailApi.users.watch, () => ({ data: { historyId: "1" } })],
  [gmailApi.users.stop, () => ({ data: {} })],
  [gmailApi.users.getProfile, () => ({ data: { emailAddress: "a@b.c" } })],
];

export function resetTransports(): void {
  for (const [fn, impl] of GMAIL_DEFAULTS) {
    fn.mockReset();
    fn.mockImplementation(async () => impl());
  }
  oauthCredentials.length = 0;
  graphCalls.length = 0;
  graphHandler = (call) => {
    if (call.method === "get" && call.path === "/me/mailFolders/archive") {
      return { id: "folder_archive", displayName: "Archive" };
    }
    return {};
  };
}
