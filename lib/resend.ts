import { Resend } from "resend";
import { db } from "./prisma";

const resend = new Resend(process.env.RESEND_API_KEY);

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

// Sent when NeatMail can no longer retrieve the user's Google OAuth token
// (they revoked access or removed the connection). Prompts them to sign in
// again and re-grant all scopes so inbox automation can resume. Throttled by
// the caller (Redis) so it goes out at most once every few days.
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

// Plain-HTML reminder sent ~24h before a card-required trial converts. Two
// variants: "you'll be charged tomorrow" (auto-renew on) vs a "trial ending"
// recap (auto-renew off, no charge coming). Throws so the BullMQ worker retries.
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

// Sent when a referrer earns a free month from a referred friend's first
// real payment. Throws so the caller's best-effort wrapper can log without
// failing the webhook that triggered it.
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

