/*
apps/worker/src/index.ts
Dependencies:
  npm install bullmq ioredis dotenv
Purpose:
  - Start a small worker process that processes queues:
    - ai jobs (call Gemini)
    - compaction jobs (persist snapshots)
*/
import { Worker, Queue, QueueScheduler } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import path from "path";
import { aiJobProcessor } from "./jobs/aiJob";
import { compactionJobProcessor } from "./jobs/compactionJob";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const connection = new IORedis(REDIS_URL);

// ensure scheduler per queue
new QueueScheduler("ai-jobs", { connection });
new QueueScheduler("compaction-jobs", { connection });

export const aiQueue = new Queue("ai-jobs", { connection });
export const compactionQueue = new Queue("compaction-jobs", { connection });

// Workers
const aiWorker = new Worker("ai-jobs", aiJobProcessor, { connection, concurrency: 2 });
const compactionWorker = new Worker("compaction-jobs", compactionJobProcessor, { connection, concurrency: 1 });

aiWorker.on("completed", (job) => {
  console.log("AI job completed", job.id);
});
aiWorker.on("failed", (job, err) => {
  console.warn("AI job failed", job?.id, err);
});

compactionWorker.on("completed", (job) => {
  console.log("compaction job completed", job.id);
});
compactionWorker.on("failed", (job, err) => {
  console.warn("compaction job failed", job?.id, err);
});

// Example export to allow enqueuing from other services
export default {
  aiQueue,
  compactionQueue,
};
