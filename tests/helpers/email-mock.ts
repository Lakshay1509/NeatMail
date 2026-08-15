import { mock, type Mock } from "bun:test";

/**
 * Stand-in for `@/lib/resend`. No test should ever hand a message to a real provider,
 * but "was this email built with the right arguments?" is worth asserting, so every
 * send is recorded.
 *
 * The export names are listed explicitly rather than proxied: Bun resolves a mocked
 * module's named exports from the object's own keys, so a Proxy would fail to link.
 * Adding a `send*Email` to lib/resend.ts means adding it here — the failure is loud
 * ("Export named 'x' not found in module"), not silent.
 */

const EMAIL_SENDERS = [
  "sendTeamInviteEmail",
  "sendMemberLeftEmail",
  "sendSubExpiredEmail",
  "sendReconnectEmail",
  "sendTrialReminderEmail",
  "sendNoisySendersFoundEmail",
  "sendPromiseDueEmail",
  "sendMailboxRevokedEmail",
  "sendRefundWithSeatsEmail",
  "sendSeatCapAlertEmail",
  "sendReferralRewardEmail",
] as const;

export type EmailSender = (typeof EMAIL_SENDERS)[number];

export interface SentEmail {
  sender: EmailSender;
  args: unknown[];
}

/** Every email the code under test tried to send, in order. */
export const sentEmails: SentEmail[] = [];

/** Emails sent through one function. */
export function emailsFrom(sender: EmailSender): SentEmail[] {
  return sentEmails.filter((email) => email.sender === sender);
}

export function resetEmails(): void {
  sentEmails.length = 0;
  for (const sender of EMAIL_SENDERS) {
    (emailModule[sender] as Mock<(...a: any[]) => any>).mockClear();
  }
}

export const emailModule = Object.fromEntries(
  EMAIL_SENDERS.map((sender) => [
    sender,
    mock(async (...args: unknown[]) => {
      sentEmails.push({ sender, args });
      return { id: `email_${sender}` };
    }),
  ]),
) as Record<EmailSender, Mock<(...args: any[]) => Promise<{ id: string }>>>;
