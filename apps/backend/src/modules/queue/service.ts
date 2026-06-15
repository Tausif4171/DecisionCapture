import type { AnalyzeResponse, PRContext } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { decisionService } from "../decisions/service.js";
import { getDecisionQueue } from "./queue.js";

export async function analyzeOrQueue(context: PRContext): Promise<AnalyzeResponse> {
  if (env.QUEUE_MODE !== "bullmq") {
    return decisionService.analyzePrContext(context);
  }

  try {
    const job = await getDecisionQueue().add("analyze-pr", context, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000
      },
      removeOnComplete: {
        age: 60 * 60,
        count: 100
      },
      removeOnFail: {
        age: 24 * 60 * 60,
        count: 100
      }
    });

    return {
      status: "queued",
      jobId: String(job.id),
      message: "PR analysis queued"
    };
  } catch (error) {
    logger.warn({ error }, "Queue unavailable; processing PR inline");
    return decisionService.analyzePrContext(context);
  }
}
