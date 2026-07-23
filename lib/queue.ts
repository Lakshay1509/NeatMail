import { Queue, FlowProducer } from "bullmq";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { redis } from "@/lib/redis";

const connection = redis;

export const outlookMailQueue = new Queue("outlook-mail", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const outlookMailUpdateQueue = new Queue("outlook-mail-update", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const gmailMailQueue = new Queue("gmail-mail", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const gmailSentQueue = new Queue("gmail-sent-mail", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const draftQueue = new Queue("draft", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const telegramQueue = new Queue("telegram", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const dbBatchQueue = new Queue("db-batch", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const classifyQueue = new Queue("classify", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const flow = new FlowProducer({ connection });

export const followUpQueue = new Queue("follow-up-draft", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Delayed one-off jobs that fire ~24h before a card-required trial's first charge,
// to send the "you'll be charged tomorrow" reminder with usage stats.
export const trialReminderQueue = new Queue("trial-reminder", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Sweeps a newly-enabled tag rule's backlog immediately instead of waiting for
// the daily cron. Idempotent, so a retry is safe.
export const archiveBacklogQueue = new Queue("archive-backlog", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// First-run "Kaboom" sweep: archives a new user's promo/social/updates/forums
// backlog out of the inbox in one shot. One job per user (jobId-deduped), and
// the archive itself is idempotent, so a retry is safe.
export const firstSweepQueue = new Queue("first-sweep", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Periodic scan that finds high-volume senders the user almost never opens and
// writes AUTO archive rules for them. Fired by a repeatable job (see
// bullmq/workers/index.ts); enforcing those rules per arrival happens in the
// mail workers, not here.
export const engagementScanQueue = new Queue("engagement-scan", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Periodic sweep that finds overdue, still-open inbound promises ("they owe
// me") and resurfaces each with a nudge draft. Fired by a repeatable job (see
// bullmq/workers/index.ts); fulfillment is handled per-arrival in the mail
// worker, not here.
export const promiseSweepQueue = new Queue("promise-sweep", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Per-promise delayed jobs that fire ~30 min before an OUTBOUND promise ("I owe
// them") comes due. Unlike promiseSweepQueue (a repeatable that scans for overdue
// inbound promises), these are one-off delayed jobs scheduled at creation time
// from the sent-mail workers, keyed by jobId=promise-nudge-<promiseId> so they can
// be cancelled when the user delivers early. See bullmq/workers/promise-nudge.ts.
export const promiseNudgeQueue = new Queue("promise-nudge", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const queueAdapters = [
  new BullMQAdapter(outlookMailQueue),
  new BullMQAdapter(outlookMailUpdateQueue),
  new BullMQAdapter(gmailMailQueue),
  new BullMQAdapter(gmailSentQueue),
  new BullMQAdapter(draftQueue),
  new BullMQAdapter(telegramQueue),
  new BullMQAdapter(dbBatchQueue),
  new BullMQAdapter(classifyQueue),
  new BullMQAdapter(followUpQueue),
  new BullMQAdapter(trialReminderQueue),
  new BullMQAdapter(archiveBacklogQueue),
  new BullMQAdapter(firstSweepQueue),
  new BullMQAdapter(engagementScanQueue),
  new BullMQAdapter(promiseSweepQueue),
  new BullMQAdapter(promiseNudgeQueue),
];
