import { Queue, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../database/prisma.js";
import { redisConnectionOptions } from "../queue/queue.js";
import { contextSyncService } from "./sync.service.js";

export const CONTEXT_QUEUE_NAME = "context-sync";

type ContextQueuePayload =
  | { kind: "sync-context"; contextId: string }
  | { kind: "process-webhook"; webhookEventId: string };

let queue: Queue<ContextQueuePayload> | undefined;
let worker: Worker<ContextQueuePayload> | undefined;

function getContextQueue() {
  if (!queue) {
    queue = new Queue<ContextQueuePayload>(CONTEXT_QUEUE_NAME, {
      connection: redisConnectionOptions()
    });
  }

  return queue;
}

async function processPayload(payload: ContextQueuePayload) {
  if (payload.kind === "sync-context") {
    return contextSyncService.sync(payload.contextId);
  }

  const { contextWebhookService } = await import("./webhook.service.js");
  return contextWebhookService.process(payload.webhookEventId);
}

async function enqueue(payload: ContextQueuePayload) {
  if (env.QUEUE_MODE !== "bullmq") {
    return processPayload(payload);
  }

  return getContextQueue().add(payload.kind, payload, {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2_000
    },
    removeOnComplete: {
      age: 60 * 60,
      count: 500
    },
    removeOnFail: {
      age: 24 * 60 * 60,
      count: 500
    }
  });
}

export async function enqueueContextSync(contextId: string) {
  await contextSyncService.prepare(contextId);

  try {
    return await enqueue({ kind: "sync-context", contextId });
  } catch (error) {
    if (env.QUEUE_MODE === "bullmq") {
      await prisma.contextSync.update({
        where: { contextId },
        data: {
          status: "FAILED",
          error: "Context synchronization queue is unavailable"
        }
      });
    }

    throw error;
  }
}

export function enqueueContextWebhook(webhookEventId: string) {
  return enqueue({ kind: "process-webhook", webhookEventId });
}

export function startContextWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker<ContextQueuePayload>(
    CONTEXT_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, kind: job.data.kind }, "Processing context job");
      return processPayload(job.data);
    },
    {
      connection: redisConnectionOptions(),
      concurrency: 3
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, kind: job.data.kind }, "Context job completed");
  });
  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, kind: job?.data.kind, error }, "Context job failed");
  });

  return worker;
}
