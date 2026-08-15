import { mock, type Mock } from "bun:test";

/**
 * BullMQ stand-in for `@/lib/queue`. Real queues open Redis connections and schedule
 * work at import time, which no unit test wants — but "did this route enqueue the job?"
 * is exactly what several routes are for, so enqueues are recorded rather than dropped.
 */

export interface EnqueuedJob {
  queue: string;
  name: string;
  data: unknown;
  opts: unknown;
}

export const enqueued: EnqueuedJob[] = [];

/** Job counts returned by `getJobCounts` — override to exercise the health route. */
export let jobCounts: Record<string, number> = {
  waiting: 0,
  active: 0,
  delayed: 0,
  completed: 0,
  failed: 0,
};

export function setJobCounts(counts: Partial<Record<string, number>>): void {
  for (const [key, value] of Object.entries(counts)) {
    if (value !== undefined) jobCounts[key] = value;
  }
}

export function resetQueues(): void {
  enqueued.length = 0;
  jobCounts = {
    waiting: 0,
    active: 0,
    delayed: 0,
    completed: 0,
    failed: 0,
  };
  for (const queue of Object.values(queues)) {
    for (const value of Object.values(queue)) {
      if (typeof value === "function" && "mockClear" in value) {
        (value as Mock<(...a: any[]) => any>).mockClear();
      }
    }
    // getJobCounts is re-programmed by some tests; restore the shared default.
    queue.getJobCounts.mockImplementation(async () => ({ ...jobCounts }));
  }
}

/** Every job pushed to one queue, in order. */
export function jobsFor(queueName: string): EnqueuedJob[] {
  return enqueued.filter((job) => job.queue === queueName);
}

function makeQueue(queueName: string) {
  return {
    name: queueName,
    add: mock(async (name: string, data: unknown, opts?: unknown) => {
      enqueued.push({ queue: queueName, name, data, opts });
      return { id: `${queueName}-${enqueued.length}`, name, data };
    }) as Mock<(...a: any[]) => any>,
    addBulk: mock(async (jobs: { name: string; data: unknown; opts?: unknown }[]) => {
      for (const job of jobs) {
        enqueued.push({
          queue: queueName,
          name: job.name,
          data: job.data,
          opts: job.opts,
        });
      }
      return jobs.map((job, i) => ({ id: `${queueName}-${i}`, ...job }));
    }) as Mock<(...a: any[]) => any>,
    getJobCounts: mock(async () => ({ ...jobCounts })),
    getJob: mock(async () => null),
    remove: mock(async () => 1),
    removeJobScheduler: mock(async () => true),
    upsertJobScheduler: mock(async () => ({ id: "scheduler" })),
    close: mock(async () => undefined),
    obliterate: mock(async () => undefined),
  };
}

/**
 * The queue exports of lib/queue.ts, listed explicitly: Bun resolves a mocked module's
 * named exports from the object's own keys, so a Proxy would fail to link. Adding a queue
 * to lib/queue.ts means adding it here — the failure is loud, not silent.
 */
const QUEUE_EXPORTS = [
  "outlookMailQueue",
  "outlookMailUpdateQueue",
  "gmailMailQueue",
  "gmailSentQueue",
  "draftQueue",
  "telegramQueue",
  "dbBatchQueue",
  "classifyQueue",
  "followUpQueue",
  "trialReminderQueue",
  "archiveBacklogQueue",
  "firstSweepQueue",
  "engagementScanQueue",
  "mailboxActivationQueue",
  "promiseSweepQueue",
  "promiseNudgeQueue",
] as const;

export type QueueName = (typeof QUEUE_EXPORTS)[number];

export const queues = Object.fromEntries(
  QUEUE_EXPORTS.map((name) => [name, makeQueue(name)]),
) as Record<QueueName, ReturnType<typeof makeQueue>>;

/** The non-queue exports: returning a queue object for `activationJobId` would break its callers. */
export const queueModule = {
  ...queues,
  flow: {
    add: mock(async (job: unknown) => job),
    addBulk: mock(async (jobs: unknown[]) => jobs),
    close: mock(async () => undefined),
  },
  activationJobId: (userId: string) => `activate-${userId}`,
  onboardScanJobId: (userId: string) => `onboard-scan-${userId}`,
  queueAdapters: [] as unknown[],
};
