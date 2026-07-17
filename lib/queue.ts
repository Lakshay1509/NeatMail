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
];
