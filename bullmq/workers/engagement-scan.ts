import { Job } from "bullmq";
import { db } from "@/lib/prisma";
import {
  runEngagementScan,
  scanUserForNoisySenders,
} from "@/lib/engagement";
import { sendNoisySendersFoundEmail } from "@/lib/resend";

interface EngagementScanJob {
  // When present, scans just this user (the dedicated post-onboarding run)
  // instead of walking every subscribed mailbox.
  userId?: string;
  // Email the user their auto-mute count when the scan finds anything.
  notify?: boolean;
}

// Runs on a repeatable schedule for the full walk, and one-off per user right
// after onboarding (see app/api/[[...route]]/onboard.ts). Both paths do the
// per-sender engagement aggregation and write AUTO archive rules; enforcing
// those rules on arrival happens separately, in the mail workers.
export async function processEngagementScan(job: Job<EngagementScanJob>) {
  const userId = job.data?.userId;

  // Dedicated per-user scan (onboarding). Subscription/tier was already verified
  // by POST /api/onboard before enqueuing, so scan the user directly.
  if (userId) {
    const rulesCreated = await scanUserForNoisySenders(userId);
    console.log(
      `[engagement-scan] user ${userId}: created ${rulesCreated} auto-mute rules`,
    );

    if (rulesCreated > 0 && job.data?.notify) {
      const user = await db.user_tokens.findUnique({
        where: { clerk_user_id: userId },
        select: { email: true, deleted_flag: true },
      });
      if (user?.email && !user.deleted_flag) {
        await sendNoisySendersFoundEmail({
          to: user.email,
          count: rulesCreated,
        });
      }
    }

    return { userId, rulesCreated };
  }

  const result = await runEngagementScan();
  console.log(
    `[engagement-scan] scanned ${result.usersScanned} users, created ${result.rulesCreated} auto-mute rules`,
  );
  return result;
}

export default processEngagementScan;
