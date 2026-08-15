import { mock, type Mock } from "bun:test";

/**
 * Doubles for the mail-provider layer: `@/lib/gmail`, `@/lib/outlook` and the
 * (misnamed) `@/lib/supabase` DB helpers.
 *
 * Installed once in setup.ts rather than per-file. `mock.module` is process-global in
 * Bun, so two files mocking `@/lib/gmail` with different export sets would fight —
 * whichever ran last would win and break the other. One shared double with every export
 * any module under test imports removes that whole class of failure; tests program the
 * individual functions they care about.
 *
 * Every export listed here is imported by something under test: archive-rules,
 * payement, cron, mailbox-activation.
 */

type AnyMock = Mock<(...args: any[]) => any>;

/** Real class, not a stub — lib/payement.ts branches on `error instanceof OAuthError`. */
export class OAuthError extends Error {
  constructor(message = "OAuth token revoked") {
    super(message);
    this.name = "OAuthError";
  }
}

export const gmail = {
  archiveGmailMessages: mock(async (_userId: string, ids: string[]) => ({
    archivedIds: ids,
  })) as AnyMock,
  activateWatch: mock(async (userId: string) => ({
    success: true,
    userId,
    history_id: "hist_1",
  })) as AnyMock,
  deactivateWatch: mock(async (_userId: string) => ({ success: true })) as AnyMock,
  getPreviousMails: mock(async () => []) as AnyMock,
};

export const outlook = {
  archiveMessagesOutlook: mock(async (_userId: string, ids: string[]) => ({
    archivedIds: ids,
  })) as AnyMock,
  createOutlookSubscription: mock(async () => [{ id: "outlook_sub_1" }]) as AnyMock,
  deleteOutlookSubscription: mock(async () => ({ success: true })) as AnyMock,
  getPreviousOutlookMails: mock(async () => []) as AnyMock,
};

export const supabaseHelpers = {
  /** Gmail by default; flip per-test for the Outlook branches. */
  getUserIsGmail: mock(async (_userId: string) => ({ isGmail: true })) as AnyMock,
  activeFolder: mock(async () => [
    { id: "folder_1", name: "Inbox", isActive: true },
  ]) as AnyMock,
  updateHistoryId: mock(async () => undefined) as AnyMock,
  updateOutlookId: mock(async () => undefined) as AnyMock,
  getUserSubscribed: mock(async () => ({ subscribed: true, tier: "MAX" })) as AnyMock,
};

export const gmailModule = { ...gmail, OAuthError };
export const outlookModule = { ...outlook };
export const supabaseModule = { ...supabaseHelpers };

const DEFAULTS: [AnyMock, (...args: any[]) => any][] = [
  [gmail.archiveGmailMessages, async (_u: string, ids: string[]) => ({ archivedIds: ids })],
  [
    gmail.activateWatch,
    async (userId: string) => ({ success: true, userId, history_id: "hist_1" }),
  ],
  [gmail.deactivateWatch, async () => ({ success: true })],
  [gmail.getPreviousMails, async () => []],
  [
    outlook.archiveMessagesOutlook,
    async (_u: string, ids: string[]) => ({ archivedIds: ids }),
  ],
  [outlook.createOutlookSubscription, async () => [{ id: "outlook_sub_1" }]],
  [outlook.deleteOutlookSubscription, async () => ({ success: true })],
  [outlook.getPreviousOutlookMails, async () => []],
  [supabaseHelpers.getUserIsGmail, async () => ({ isGmail: true })],
  [supabaseHelpers.activeFolder, async () => [{ id: "folder_1", name: "Inbox", isActive: true }]],
  [supabaseHelpers.updateHistoryId, async () => undefined],
  [supabaseHelpers.updateOutlookId, async () => undefined],
  [supabaseHelpers.getUserSubscribed, async () => ({ subscribed: true, tier: "MAX" })],
];

export function resetProviders(): void {
  for (const [fn, impl] of DEFAULTS) {
    fn.mockReset();
    fn.mockImplementation(impl);
  }
}
