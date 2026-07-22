import { Resend } from "resend";
import { db } from "./prisma";
import type { Tier } from "./tiers";

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL;

// Plain ops alerts to the operator, not customer mail: monospace, no branding.
async function opsAlert(subject: string, body: string, context: string) {
  if (!ADMIN_ALERT_EMAIL) {
    console.error("[ops-alert] ADMIN_ALERT_EMAIL unset; %s not reported: %s", context, subject);
    return;
  }
  try {
    await resend.emails.send({
      from: "NeatMail Ops <notifications@send.neatmail.app>",
      to: ADMIN_ALERT_EMAIL,
      subject,
      html: `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(body)}</pre>`,
    });
  } catch (error) {
    console.error(`[ops-alert] failed to send "${context}" alert:`, error);
  }
}

// Escape user-controlled values (team name, inviter name) before HTML interpolation.
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

interface TeamInviteEmailParams {
  to: string;
  inviterName: string | null;
  inviterEmail: string | null;
  teamName: string;
  link: string;
}

// Sent when an invite is locked to an email; the link is also shown to the
// owner as a manual-share fallback. Caller swallows errors so a bad send doesn't fail the invite.
export async function sendTeamInviteEmail(params: TeamInviteEmailParams) {
  const { to, inviterName, inviterEmail, teamName, link } = params;
  const inviter = escapeHtml(
    inviterName?.trim() || inviterEmail || "A NeatMail user",
  );
  const team = escapeHtml(teamName);

  const subject = `${inviter} invited you to join ${team} on NeatMail`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;line-height:1.6;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="font-size:20px;margin:0 0 16px;">You've been invited to join a team on NeatMail</h2>
  <p style="font-size:15px;color:#444;margin:0 0 16px;">
    <strong>${inviter}</strong> invited you to join <strong>${team}</strong> on NeatMail — an AI assistant that organizes your inbox, drafts replies, and clears the noise.
  </p>
  <p style="font-size:15px;color:#444;margin:0 0 24px;">
    You'll share their plan while you're on the team. Accept the invite to get started:
  </p>
  <a href="${link}" style="display:inline-block;padding:11px 22px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept invite</a>
  <p style="font-size:13px;color:#888;margin:24px 0 0;">
    This invite is single-use and expires in 7 days. If the button doesn't work, paste this link into your browser:<br/>
    <a href="${link}" style="color:#555555;word-break:break-all;">${link}</a>
  </p>
  <p style="font-size:12px;color:#888;margin-top:24px;">If you weren't expecting this, you can safely ignore this email. — The NeatMail team</p>
</body>
</html>`;

  await resend.emails.send({
    from: "NeatMail <notifications@send.neatmail.app>",
    to,
    subject,
    html,
  });
}

interface MemberLeftEmailParams {
  to: string; // team owner (admin) email
  memberEmail: string; // the teammate who left
  teamName: string;
}

// Sent when a member leaves voluntarily (POST /organization/leave), not on
// admin-initiated removal. Caller swallows errors so a bad send doesn't block the leave.
export async function sendMemberLeftEmail(params: MemberLeftEmailParams) {
  const { to, memberEmail, teamName } = params;
  const member = escapeHtml(memberEmail);
  const team = escapeHtml(teamName);

  // Subject is plain text, use raw values, not HTML-escaped ones.
  const subject = `${memberEmail} left ${teamName} on NeatMail`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;line-height:1.6;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="font-size:20px;margin:0 0 16px;">A member left your team</h2>
  <p style="font-size:15px;color:#444;margin:0 0 16px;">Hi there,</p>
  <p style="font-size:15px;color:#444;margin:0 0 16px;">
    <strong>${member}</strong> has left <strong>${team}</strong> on NeatMail. Their
    plan coverage has ended and their seat is now free.
  </p>
  <p style="font-size:15px;color:#444;margin:0 0 24px;">
    You can invite someone else in their place from your team settings:
  </p>
  <a href="https://dashboard.neatmail.app/organization" style="display:inline-block;padding:11px 22px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Manage your team</a>
  <p style="font-size:12px;color:#888;margin-top:24px;">You're receiving this because you own this team on NeatMail. — The NeatMail team</p>
</body>
</html>`;

  await resend.emails.send({
    from: "NeatMail <notifications@send.neatmail.app>",
    to,
    subject,
    html,
  });
}

export async function sendSubExpiredEmail(userEmail:string, userName:string){

    try{
        const now = new Date();
        const startOfPeriod = new Date(now);
          startOfPeriod.setDate(startOfPeriod.getDate() - 30);

          const endOfPeriod = new Date(now);
        const data = await db.email_tracked.count({
                    where: {
                      user_tokens:{
                        email:userEmail
                      },
                      created_at: {
                        gte: startOfPeriod,
                        lt: endOfPeriod,
                      },
                    },
                  });
         await resend.emails.send({
            to: userEmail,
            template: {
              id: "subscription-ended-reminder",
              variables: {
                firstName: userName ?? "User",
                last30DaysCount: String(data),
                renewalLink: "https://dashboard.neatmail.app/billing",
              },
            },
          });
    }catch(_error){
        console.error('Error sending reminder to user')    //Don't throw new Error to prevent webhook retry

    }
}

// Sent when the OAuth token is unreachable (revoked/removed). Caller throttles
// via Redis to at most once every few days. `provider` tailors the copy to the
// mailbox the user connected (Google for Gmail, Microsoft for Outlook).
export async function sendReconnectEmail(
  userEmail: string,
  userName: string,
  provider: "Google" | "Microsoft" = "Google",
) {
  const firstName = userName?.trim().split(" ")[0] || "there";

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
    <h2 style="font-size:20px;color:#111;margin:0 0 16px;">Reconnect NeatMail to keep your inbox organized</h2>
    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px;">
      Hi ${firstName},
    </p>
    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px;">
      NeatMail lost access to your ${provider} account, so we've paused organizing your inbox.
      This usually happens when the connection is removed or access is revoked.
    </p>
    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
      To resume automatic labelling, drafts, and follow-ups, please sign in again and
      grant <strong>all the requested permissions</strong>.
    </p>
    <a href="https://dashboard.neatmail.app" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Reconnect NeatMail</a>
    <p style="font-size:12px;color:#888;margin-top:24px;">If you didn't change anything, signing in again will restore everything. — The NeatMail team</p>
  </div>`;

  await resend.emails.send({
    from: "NeatMail <notifications@send.neatmail.app>",
    to: userEmail,
    subject: "Action needed: reconnect NeatMail to keep your inbox organized",
    html,
  });
}

interface TrialReminderEmailParams {
  to: string;
  name: string;
  labelled: number;
  timeSavedLabel: string;
  willCharge: boolean;
  chargeAmountLabel: string | null;
  chargeDateLabel: string;
}

// Sent ~24h before a card-required trial converts; copy varies by auto-renew
// state. Throws (unlike other senders here) so the BullMQ worker retries.
export async function sendTrialReminderEmail(params: TrialReminderEmailParams) {
  const {
    to,
    name,
    labelled,
    timeSavedLabel,
    willCharge,
    chargeAmountLabel,
    chargeDateLabel,
  } = params;

  const firstName = name?.trim().split(" ")[0] || "there";

  const subject = willCharge
    ? `Your NeatMail trial ends tomorrow${
        chargeAmountLabel ? ` — ${chargeAmountLabel} on ${chargeDateLabel}` : ""
      }`
    : "Your NeatMail trial ends tomorrow";

  const lead = willCharge
    ? `Your 7-day NeatMail trial ends tomorrow${
        chargeAmountLabel
          ? `, and your card will be charged ${chargeAmountLabel} on ${chargeDateLabel}`
          : `, and your subscription begins on ${chargeDateLabel}`
      }. No action needed if you'd like to continue.`
    : `Your 7-day NeatMail trial ends tomorrow. Auto-renew is off, so you won't be charged — your account will return to the Free plan on ${chargeDateLabel}.`;

  const footerNote = willCharge
    ? `<p>Changed your mind? You can cancel before ${chargeDateLabel} from your billing page.</p>`
    : `<p>Want to keep your access? Turn auto-renew back on before ${chargeDateLabel} from your billing page.</p>`;

  // Avoid an awkward "0 emails labelled" recap for users with no trial activity.
  const statsBlock =
    labelled > 0
      ? `<p style="margin:24px 0 4px;"><strong>Here's what NeatMail did for you during your trial:</strong></p>
  <ul>
    <li><strong>${labelled.toLocaleString()}</strong> emails automatically labelled</li>
    <li>About <strong>${timeSavedLabel}</strong> of inbox triage saved</li>
  </ul>`
      : `<p style="margin:24px 0;">NeatMail is set up and watching your inbox — new emails will be sorted and labelled automatically.</p>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111111;line-height:1.6;">
  <p>Hi ${firstName},</p>
  <h2 style="margin:0 0 8px;">Your free trial ends tomorrow</h2>
  <p>${lead}</p>
  ${statsBlock}
  ${footerNote}
  <p><a href="https://dashboard.neatmail.app/billing">Manage your subscription</a></p>
  <p style="color:#888888;font-size:12px;margin-top:24px;">— The NeatMail team</p>
</body>
</html>`;

  await resend.emails.send({
    from: "NeatMail <trials@send.neatmail.app>",
    to,
    subject,
    html,
  });
}

interface NoisySendersFoundParams {
  to: string;
  count: number;
}

// Sent right after onboarding when the dedicated engagement scan auto-mutes one
// or more noisy senders from the imported history. Only fires when count > 0.
// Throws so the BullMQ worker can retry a transient send failure.
export async function sendNoisySendersFoundEmail(params: NoisySendersFoundParams) {
  const { to, count } = params;
  const senderWord = count === 1 ? "sender" : "senders";

  const subject = `We found ${count} noisy ${senderWord} in your inbox`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111;line-height:1.6;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="font-size:20px;margin:0 0 16px;">🧹 We cleared out some inbox noise</h2>
  <p style="font-size:15px;color:#444;margin:0 0 16px;">Hi there,</p>
  <p style="font-size:15px;color:#444;margin:0 0 16px;">
    NeatMail scanned your inbox and found <strong>${count}</strong> ${senderWord} you almost
    never open. From now on we'll <strong>auto-archive their emails</strong> so they skip your
    inbox and stop cluttering it.
  </p>
  <p style="font-size:15px;color:#444;margin:0 0 24px;">
    Nothing is deleted, and this is fully reversible — un-mute any sender in one click, or just
    open one of their emails and they're back.
  </p>
  <a href="https://dashboard.neatmail.app/unsubscribe" style="display:inline-block;padding:11px 22px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Review muted senders</a>
  <p style="font-size:12px;color:#888;margin-top:24px;">You're receiving this because NeatMail just set up auto-archiving for your inbox. — The NeatMail team</p>
</body>
</html>`;

  await resend.emails.send({
    from: "NeatMail <notifications@send.neatmail.app>",
    to,
    subject,
    html,
  });
}

interface MailboxRevokedParams {
  ownerId: string;
  reason: string;
  revokedCount: number;
  dodoPaymentId: string;
}

/** Sent after a chargeback strips a customer's paid mailbox seats automatically. */
export async function sendMailboxRevokedEmail(params: MailboxRevokedParams) {
  const { ownerId, reason, revokedCount, dodoPaymentId } = params;
  await opsAlert(
    `[NeatMail] ${revokedCount} paid mailbox(es) revoked (${reason})`,
    `Owner: ${ownerId}\nReason: ${reason}\nSeats revoked: ${revokedCount}\nPayment: ${dodoPaymentId}\n\n` +
      `Teammates left over the seat cap are paused, not deleted; see the seat-cap alert.`,
    "mailbox-revoke",
  );
}

interface RefundWithSeatsParams {
  ownerId: string;
  seatCount: number;
  dodoPaymentId: string;
  amount: number;
  currency: string;
  isPartial: boolean;
}

// Refunds are merchant-initiated and we can't tell what they covered, so
// nothing changes automatically. The operator decides.
export async function sendRefundWithSeatsEmail(params: RefundWithSeatsParams) {
  const { ownerId, seatCount, dodoPaymentId, amount, currency, isPartial } = params;
  await opsAlert(
    `[NeatMail] Refund on a subscription with ${seatCount} paid mailbox(es)`,
    `NOTHING WAS CHANGED; you issued this refund, so you decide.\n\n` +
      `Owner: ${ownerId}\nPaid seats: ${seatCount}\nPayment: ${dodoPaymentId}\n` +
      `Refund: ${(amount / 100).toFixed(2)} ${currency}${isPartial ? " (partial)" : ""}\n\n` +
      `If this refund covered a SEAT purchase, remove the seats in the DodoPay dashboard.`,
    "refund-with-seats",
  );
}

interface SeatCapAlertParams {
  ownerId: string;
  tier: Tier;
  seatCap: number;
  memberCount: number;
  pausedUserIds: string[];
}

// Nothing un-pauses these members automatically. An over-cap pause looks
// identical to an admin's deliberate one, so restoring is a human call.
// Never throws: the webhook must still ack.
export async function sendSeatCapAlertEmail(params: SeatCapAlertParams) {
  const { ownerId, tier, seatCap, memberCount, pausedUserIds } = params;
  await opsAlert(
    `[NeatMail] ${pausedUserIds.length} member(s) paused (team over seat cap, ${tier})`,
    `Owner: ${ownerId}\nTier: ${tier}\nSeat cap: ${seatCap}\nActive members: ${memberCount}\n` +
      `Paused: ${pausedUserIds.join(", ")}\n\n` +
      `These members are not removed; their membership, seat and tier are intact and reversible. ` +
      `Nothing un-pauses automatically (an over-cap pause looks identical to an admin's deliberate pause).`,
    "seat-cap",
  );
}

interface ReferralRewardEmailParams {
  to: string;
  monthsGranted: number;
  monthsCap: number;
}

// Sent when a referrer earns a free month. Throws so the caller's wrapper can
// log without failing the triggering webhook.
export async function sendReferralRewardEmail(params: ReferralRewardEmailParams) {
  const { to, monthsGranted, monthsCap } = params;

  const subject = `You've earned a free month of NeatMail (${monthsGranted} of ${monthsCap})`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111111;line-height:1.6;">
  <p>Hi there,</p>
  <h2 style="margin:0 0 8px;">A friend you referred just subscribed 🎉</h2>
  <p>As a thank you, we've pushed your next billing date back by one month — you now have
  <strong>${monthsGranted} of ${monthsCap}</strong> free months banked from referrals.</p>
  <p>Keep sharing your referral link — you can refer as many friends as you like, though
  rewards cap out at ${monthsCap} free months total.</p>
  <p><a href="https://dashboard.neatmail.app/billing">View your billing details</a></p>
  <p style="color:#888888;font-size:12px;margin-top:24px;">— The NeatMail team</p>
</body>
</html>`;

  await resend.emails.send({
    from: "NeatMail <trials@send.neatmail.app>",
    to,
    subject,
    html,
  });
}

