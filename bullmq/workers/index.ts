import { Worker } from "bullmq";
import { redis } from "@/lib/redis";
import { processOutlookMail } from "./process-outlook-mail";
import { updateOutlookMail } from "./update-outlook-mail";
import { processDraft } from "./process-draft";
import { telegramAgent } from "./telegram-agent";

const connection = redis;

const outlookMailWorker = new Worker("outlook-mail", processOutlookMail, {
  connection,
  concurrency: 10,
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
});

const telegramWorker = new Worker("telegram", telegramAgent, {
  connection,
  concurrency: 5,
});

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    outlookMailWorker.close(),
    outlookMailUpdateWorker.close(),
    draftWorker.close(),
    telegramWorker.close(),
  ]);
  console.log("Workers shut down.");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("BullMQ workers started:");
console.log("  - outlook-mail");
console.log("  - outlook-mail-update");
console.log("  - draft");
console.log("  - telegram");
