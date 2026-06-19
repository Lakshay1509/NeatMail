import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { processOutlookMail } from "./process-outlook-mail";
import { updateOutlookMail } from "./update-outlook-mail";
import { processDraft } from "./process-draft";
import { telegramAgent } from "./telegram-agent";
import { processDbBatch } from "./process-db-batch";
import { processClassify } from "./process-classify";
import { processFollowUpDraft } from "./follow-up-draft";
import { dbBatchQueue, classifyQueue } from "@/lib/queue";

export const runtime = "nodejs";

let workers: Worker[] = [];

export async function startWorkers() {
  const connection = redis;

  const outlookMailWorker = new Worker("outlook-mail", processOutlookMail, {
    connection,
    concurrency: 10,
    lockDuration: 120_000,
  });

  const outlookMailUpdateWorker = new Worker(
    "outlook-mail-update",
    updateOutlookMail,
    {
      connection,
      concurrency: 10,
    },
  );

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

  workers = [
    outlookMailWorker,
    outlookMailUpdateWorker,
    draftWorker,
    telegramWorker,
    dbBatchWorker,
    classifyWorker,
    followUpDraftWorker,
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
