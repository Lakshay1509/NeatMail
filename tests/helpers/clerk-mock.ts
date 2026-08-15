/**
 * Clerk stand-in. Every API route starts with `const { userId } = await auth()`, so the
 * signed-in identity is the single knob tests need. Import `setAuthUser` from here (the
 * same module instance setup.ts wires into `@clerk/nextjs/server`) and set it per test.
 */

interface FakeUser {
  id: string;
  emailAddresses: { emailAddress: string }[];
  /** Clerk's convenience accessor; routes read this in preference to emailAddresses[0]. */
  primaryEmailAddress: { emailAddress: string } | null;
  firstName: string | null;
  lastName: string | null;
  /** Clerk derives this from first + last name; null when neither is set. */
  fullName: string | null;
}

let currentUserId: string | null = null;
let users = new Map<string, FakeUser>();

/**
 * OAuth tokens Clerk brokers for the mail providers. `getGmailClient` and
 * `getGraphClient` both read them, and an absent token is what raises `OAuthError` —
 * so tests set `null` here to drive the reconnect paths.
 */
let oauthTokens: Record<string, string | null> = {
  google: "ya29.test-google-token",
  microsoft: "eyJ.test-microsoft-token",
};
let oauthError: Error | null = null;

/** Sets (or clears, with `null`) the provider token Clerk hands back. */
export function setOauthToken(provider: string, token: string | null): void {
  oauthTokens[provider] = token;
}

/** Makes the token lookup itself throw — a revoked account, or a Clerk outage. */
export function setOauthError(error: Error | null): void {
  oauthError = error;
}

/** Signs a user in for subsequent `auth()` calls. Pass `null` for an anonymous request. */
export function setAuthUser(userId: string | null): void {
  currentUserId = userId;
}

export function getAuthUser(): string | null {
  return currentUserId;
}

/**
 * Registers a user record returned by `currentUser()` and `clerkClient().users.getUser()`.
 * `fullName` and `primaryEmailAddress` are derived the way Clerk derives them, so callers
 * only have to set the underlying fields — but either can still be overridden directly.
 */
export function setClerkUser(
  userId: string,
  overrides: Partial<FakeUser> = {},
): void {
  const base = {
    id: userId,
    emailAddresses: [{ emailAddress: `${userId}@example.com` }],
    firstName: "Test" as string | null,
    lastName: "User" as string | null,
    ...overrides,
  };

  const name = [base.firstName, base.lastName].filter(Boolean).join(" ");

  users.set(userId, {
    ...base,
    fullName: overrides.fullName !== undefined ? overrides.fullName : name || null,
    primaryEmailAddress:
      overrides.primaryEmailAddress !== undefined
        ? overrides.primaryEmailAddress
        : (base.emailAddresses[0] ?? null),
  });
}

export function resetClerk(): void {
  currentUserId = null;
  users = new Map();
  oauthTokens = {
    google: "ya29.test-google-token",
    microsoft: "eyJ.test-microsoft-token",
  };
  oauthError = null;
}

export const clerkServerModule = {
  auth: async () => ({
    userId: currentUserId,
    sessionId: currentUserId ? `sess_${currentUserId}` : null,
    orgId: null,
    getToken: async () => (currentUserId ? "test-token" : null),
    // Routes that guard with `auth.protect()` should 404/throw when signed out,
    // matching Clerk's real behaviour rather than silently continuing.
    protect: () => {
      if (!currentUserId) throw new Error("Unauthorized");
      return { userId: currentUserId };
    },
  }),
  currentUser: async () =>
    currentUserId ? (users.get(currentUserId) ?? null) : null,
  clerkClient: async () => ({
    users: {
      getUser: async (id: string) => {
        const user = users.get(id);
        if (!user) throw new Error(`Clerk user not found: ${id}`);
        return user;
      },
      updateUserMetadata: async (id: string) => ({ id }),
      deleteUser: async (id: string) => ({ id }),
      // Shape matches Clerk's real response: `{ data: [{ token }] }`, empty when the
      // user has not connected (or has revoked) that provider.
      getUserOauthAccessToken: async (_id: string, provider: string) => {
        if (oauthError) throw oauthError;
        const token = oauthTokens[provider];
        return { data: token ? [{ token, provider }] : [] };
      },
    },
  }),
  getAuth: () => ({ userId: currentUserId }),
  verifyToken: async () => ({ sub: currentUserId }),
};
