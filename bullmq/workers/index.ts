import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { processOutlookMail } from "./process-outlook-mail";
import { updateOutlookMail } from "./update-outlook-mail";
import { processDraft } from "./process-draft";
import { telegramAgent } from "./telegram-agent";

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

  workers = [
    outlookMailWorker,
    outlookMailUpdateWorker,
    draftWorker,
    telegramWorker,
  ];

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
