import { Queue, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { redisConnectionOptions } from "../queue/queue.js";
import { conflictService } from "./service.js";

export const CONFLICT_QUEUE_NAME = "conflict-detection";

type ConflictQueuePayload =
  | { kind: "process-webhook"; webhookEventId: string }
  | { kind: "run-scan"; scanId: string };

let queue: Queue<ConflictQueuePayload> | undefined;
let worker: Worker<ConflictQueuePayload> | undefined;

function getQueue() {
  if (!queue) {
    queue = new Queue<ConflictQueuePayload>(CONFLICT_QUEUE_NAME, {
      connection: redisConnectionOptions()
    });
  }

  return queue;
}

async function processPayload(payload: ConflictQueuePayload) {
  if (payload.kind === "process-webhook") {
    return conflictService.processWebhook(payload.webhookEventId);
  }

  return conflictService.runScan(payload.scanId);
}

async function enqueue(payload: ConflictQueuePayload, jobId: string) {
  if (env.QUEUE_MODE !== "bullmq") {
    return processPayload(payload);
  }

  return getQueue().add(payload.kind, payload, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 60 * 60, count: 500 },
    removeOnFail: { age: 24 * 60 * 60, count: 500 }
  });
}

export function enqueueConflictWebhook(webhookEventId: string) {
  return enqueue({ kind: "process-webhook", webhookEventId }, `conflict-webhook:${webhookEventId}`);
}

export function scheduleConflictScan(scanId: string) {
  return enqueue({ kind: "run-scan", scanId }, `conflict-scan:${scanId}`);
}

export function startConflictWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker<ConflictQueuePayload>(
    CONFLICT_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, kind: job.data.kind }, "Processing conflict intelligence job");
      return processPayload(job.data);
    },
    {
      connection: redisConnectionOptions(),
      concurrency: env.CONFLICT_QUEUE_CONCURRENCY
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Conflict intelligence job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error }, "Conflict intelligence job failed");
  });

  return worker;
}
