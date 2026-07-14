import { Resend } from "resend";
import { db } from "./prisma";

const resend = new Resend(process.env.RESEND_API_KEY);

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

// Sent when the Google OAuth token is unreachable (revoked/removed). Caller
// throttles via Redis to at most once every few days.
export async function sendReconnectEmail(userEmail: string, userName: string) {
  const firstName = userName?.trim().split(" ")[0] || "there";

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
    <h2 style="font-size:20px;color:#111;margin:0 0 16px;">Reconnect NeatMail to keep your inbox organized</h2>
    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px;">
      Hi ${firstName},
    </p>
    <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 16px;">
      NeatMail lost access to your Google account, so we've paused organizing your inbox.
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

