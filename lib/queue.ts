import { Queue, FlowProducer } from "bullmq";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { redis } from "@/lib/redis";

const connection = redis;

export const outlookMailQueue = new Queue("outlook-mail", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const outlookMailUpdateQueue = new Queue("outlook-mail-update", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const draftQueue = new Queue("draft", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const telegramQueue = new Queue("telegram", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const flow = new FlowProducer({ connection });

export const queueAdapters = [
  new BullMQAdapter(outlookMailQueue),
  new BullMQAdapter(outlookMailUpdateQueue),
  new BullMQAdapter(draftQueue),
  new BullMQAdapter(telegramQueue),
];
