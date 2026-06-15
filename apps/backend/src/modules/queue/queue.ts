import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { AnalyzeResponse, PRContext } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { decisionService } from "../decisions/service.js";

export const DECISION_QUEUE_NAME = "decision-analysis";

let queue: Queue<PRContext, AnalyzeResponse> | undefined;
let worker: Worker<PRContext, AnalyzeResponse> | undefined;

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
    queue = new Queue<PRContext, AnalyzeResponse>(DECISION_QUEUE_NAME, {
      connection: redisConnectionOptions()
    });
  }

  return queue;
}

export function startDecisionWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker<PRContext, AnalyzeResponse>(
    DECISION_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, prNumber: job.data.prNumber }, "Processing PR analysis job");
      return decisionService.analyzePrContext(job.data);
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
