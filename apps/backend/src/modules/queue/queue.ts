import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { processDecisionContext } from "../decisions/processor.js";
import {
  type DecisionQueuePayload,
  type DecisionQueueResult
} from "./types.js";

export const DECISION_QUEUE_NAME = "decision-analysis";

let queue: Queue<DecisionQueuePayload, DecisionQueueResult> | undefined;
let worker: Worker<DecisionQueuePayload, DecisionQueueResult> | undefined;

function redisConnectionOptions(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

export function getDecisionQueue() {
  if (!queue) {
    queue = new Queue<DecisionQueuePayload, DecisionQueueResult>(DECISION_QUEUE_NAME, {
      connection: redisConnectionOptions()
    });
  }

  return queue;
}

export function startDecisionWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker<DecisionQueuePayload, DecisionQueueResult>(
    DECISION_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, prNumber: job.data.prNumber }, "Processing PR analysis job");
      return processDecisionContext(job.data);
    },
    {
      connection: redisConnectionOptions(),
      concurrency: 3
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "PR analysis job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error }, "PR analysis job failed");
  });

  return worker;
}
