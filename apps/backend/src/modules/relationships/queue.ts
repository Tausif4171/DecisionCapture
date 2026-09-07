import { Queue, Worker } from "bullmq";
import type { DecisionRelationshipAnalysisResponse } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { ReviewActor } from "../auth/types.js";
import { redisConnectionOptions } from "../queue/queue.js";
import { decisionRelationshipService } from "./service.js";
import type { RelationshipAnalysisRequest, RelationshipQueueResult } from "./types.js";

export const RELATIONSHIP_QUEUE_NAME = "decision-relationship-analysis";

type RelationshipQueuePayload = {
  decisionId: string;
};

let queue: Queue<RelationshipQueuePayload, RelationshipQueueResult> | undefined;
let worker: Worker<RelationshipQueuePayload, RelationshipQueueResult> | undefined;

function getRelationshipQueue() {
  if (!queue) {
    queue = new Queue<RelationshipQueuePayload, RelationshipQueueResult>(RELATIONSHIP_QUEUE_NAME, {
      connection: redisConnectionOptions()
    });
  }

  return queue;
}

async function enqueuePreparedAnalysis(
  decisionId: string,
  analysis: DecisionRelationshipAnalysisResponse["analysis"]
): Promise<DecisionRelationshipAnalysisResponse> {
  try {
    await getRelationshipQueue().add(
      "analyze-decision-relationships",
      { decisionId },
      {
        jobId: `relationship-${decisionId}-${Date.now()}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 24 * 60 * 60, count: 100 }
      }
    );

    return { status: "queued", analysis };
  } catch (error) {
    await decisionRelationshipService.markAnalysisFailed(decisionId, error);
    throw error;
  }
}

export async function requestRelationshipAnalysis({
  decisionId,
  actor = { authRequired: false }
}: RelationshipAnalysisRequest): Promise<DecisionRelationshipAnalysisResponse> {
  const prepared = await decisionRelationshipService.prepareAnalysis(decisionId, actor);
  if (!prepared.shouldStart) {
    return { status: "already_running", analysis: prepared.analysis };
  }

  if (env.QUEUE_MODE !== "bullmq") {
    const analysis = await decisionRelationshipService.runAnalysis(decisionId);
    return { status: "completed", analysis };
  }

  return enqueuePreparedAnalysis(decisionId, prepared.analysis);
}

export async function scheduleRelationshipAnalysis(
  decisionId: string,
  actor: ReviewActor = { authRequired: false }
) {
  if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
    return;
  }

  const prepared = await decisionRelationshipService.prepareAnalysis(decisionId, actor);
  if (!prepared.shouldStart) {
    return;
  }

  if (env.QUEUE_MODE === "bullmq") {
    await enqueuePreparedAnalysis(decisionId, prepared.analysis);
    return;
  }

  void decisionRelationshipService.runAnalysis(decisionId).catch((error) => {
    logger.error({ error, decisionId }, "Inline relationship analysis failed");
  });
}

export function startRelationshipWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker<RelationshipQueuePayload, RelationshipQueueResult>(
    RELATIONSHIP_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, decisionId: job.data.decisionId }, "Analyzing decision relationships");
      const analysis = await decisionRelationshipService.runAnalysis(job.data.decisionId);
      return { status: "completed", analysis };
    },
    {
      connection: redisConnectionOptions(),
      concurrency: 1
    }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, decisionId: job.data.decisionId }, "Relationship analysis completed");
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, decisionId: job?.data.decisionId, error },
      "Relationship analysis failed"
    );
  });

  return worker;
}
