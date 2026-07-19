import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { processOutlookMail } from "./process-outlook-mail";
import { updateOutlookMail } from "./update-outlook-mail";
import { processGmailMail } from "./process-gmail-mail";
import { processGmailSent } from "./process-gmail-sent";
import { processDraft } from "./process-draft";
import { telegramAgent } from "./telegram-agent";
import { processDbBatch } from "./process-db-batch";
import { processClassify } from "./process-classify";
import { processFollowUpDraft } from "./follow-up-draft";
import { processTrialReminder } from "./trial-reminder";
import { processArchiveBacklog } from "./archive-tag-backlog";
import { processFirstSweep } from "./first-sweep";
import { processEngagementScan } from "./engagement-scan";
import { dbBatchQueue, classifyQueue, engagementScanQueue } from "@/lib/queue";

// Shared cap protecting Gmail/Outlook API quota: at most 10 jobs run at once,
// and no more than 10 new jobs start per rolling second — so a burst of 100
// queued messages drains in ~10 batches of 10 rather than all at once.
const MAIL_API_LIMITER = { max: 10, duration: 1000 };

export const runtime = "nodejs";

let workers: Worker[] = [];

export async function startWorkers() {
  const connection = redis;

  const outlookMailWorker = new Worker("outlook-mail", processOutlookMail, {
    connection,
    concurrency: 10,
    limiter: MAIL_API_LIMITER,
    lockDuration: 120_000,
  });

  const outlookMailUpdateWorker = new Worker(
    "outlook-mail-update",
    updateOutlookMail,
    {
      connection,
      concurrency: 10,
      limiter: MAIL_API_LIMITER,
    },
  );

  const gmailMailWorker = new Worker("gmail-mail", processGmailMail, {
    connection,
    concurrency: 10,
    limiter: MAIL_API_LIMITER,
    lockDuration: 120_000,
  });

  const gmailSentWorker = new Worker("gmail-sent-mail", processGmailSent, {
    connection,
    concurrency: 10,
    limiter: MAIL_API_LIMITER,
    lockDuration: 120_000,
  });

  const draftWorker = new Worker("draft", processDraft, {
    connection,
    concurrency: 5,
    lockDuration: 300_000,
  });

  const telegramWorker = new Worker("telegram", telegramAgent, {
    connection,
    concurrency: 5,
  });

  const dbBatchWorker = new Worker("db-batch", processDbBatch, {
    connection,
    concurrency: 1,
    lockDuration: 30_000,
  });

  const classifyWorker = new Worker("classify", processClassify, {
    connection,
    concurrency: 1,
    lockDuration: 120_000,
  });

  const followUpDraftWorker = new Worker("follow-up-draft", processFollowUpDraft, {
    connection,
    concurrency: 5,
    lockDuration: 120_000,
  });

  const trialReminderWorker = new Worker("trial-reminder", processTrialReminder, {
    connection,
    concurrency: 5,
  });

  // Low concurrency: each job can fan a single backlog into many Gmail/Outlook
  // calls, which the provider helpers already chunk internally.
  const archiveBacklogWorker = new Worker("archive-backlog", processArchiveBacklog, {
    connection,
    concurrency: 3,
    limiter: MAIL_API_LIMITER,
    lockDuration: 300_000,
  });

  // One job fans a whole inbox backlog into many Gmail calls (chunked internally
  // by the archive helpers), so keep concurrency low and the lock long.
  const firstSweepWorker = new Worker("first-sweep", processFirstSweep, {
    connection,
    concurrency: 3,
    limiter: MAIL_API_LIMITER,
    lockDuration: 600_000,
  });

  // No Gmail/Outlook calls here, just DB reads, so no need for the mail limiter.
  // Concurrency 1 with a long lock since one run walks every subscribed mailbox.
  const engagementScanWorker = new Worker(
    "engagement-scan",
    processEngagementScan,
    {
      connection,
      concurrency: 1,
      lockDuration: 600_000,
    },
  );

  workers = [
    outlookMailWorker,
    outlookMailUpdateWorker,
    gmailMailWorker,
    gmailSentWorker,
    draftWorker,
    telegramWorker,
    dbBatchWorker,
    classifyWorker,
    followUpDraftWorker,
    trialReminderWorker,
    archiveBacklogWorker,
    firstSweepWorker,
    engagementScanWorker,
  ];

  await dbBatchQueue.add("flush-db-batch", {}, {
    repeat: {
      pattern: "*/10 * * * * *",
    },
    removeOnComplete: true,
    removeOnFail: false,
    jobId: "flush-db-batch-repeat",
  });

  await classifyQueue.add("flush-classify", {}, {
    repeat: {
      pattern: "*/30 * * * * *",
    },
    removeOnComplete: true,
    removeOnFail: false,
    jobId: "flush-classify-repeat",
  });

  // Re-scans every 6 hours for senders the user ignores and creates AUTO
  // archive rules. jobId keeps this a single repeatable across restarts.
  await engagementScanQueue.add("scan", {}, {
    repeat: {
      pattern: "0 */6 * * *",
    },
    removeOnComplete: true,
    removeOnFail: false,
    jobId: "engagement-scan-repeat",
  });

  console.log("BullMQ workers started (in-process)");
}

export async function stopWorkers() {
  console.log("Shutting down BullMQ workers...");
  await Promise.all(workers.map((w) => w.close()));
  console.log("BullMQ workers shut down.");
}

if (process.argv[1]?.includes("bullmq/workers/index")) {
  startWorkers();
}
