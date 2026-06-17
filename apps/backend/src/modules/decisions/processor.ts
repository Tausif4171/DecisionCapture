import type { AnalyzeResponse, DecisionMemory, PRContext } from "@decisioncapture/shared";
import { logger } from "../../config/logger.js";
import { prisma } from "../database/prisma.js";
import { syncDecisionReviewComment } from "../github/service.js";
import { prContextSchema } from "./validation.js";
import { decisionService } from "./service.js";

async function syncDecisionNotification(context: PRContext, decision: DecisionMemory) {
  try {
    await syncDecisionReviewComment({ context, decision });
  } catch (error) {
    logger.error({ error, decisionId: decision.id, prNumber: context.prNumber }, "Failed to sync PR review comment");
  }
}

export async function processDecisionContext(context: PRContext): Promise<AnalyzeResponse> {
  const result = await decisionService.analyzePrContext(context);

  if (result.status !== "processed" || !result.decision) {
    return result;
  }

  await syncDecisionNotification(context, result.decision);
  return result;
}

export async function syncDecisionNotificationFromStoredContext(decision: DecisionMemory) {
  if (!decision.prRecordId) {
    return;
  }

  const prRecord = await prisma.pullRequestRecord.findUnique({
    where: { id: decision.prRecordId },
    select: { sourcePayload: true }
  });

  if (!prRecord?.sourcePayload) {
    logger.warn({ decisionId: decision.id }, "Decision review comment sync skipped because PR context is missing");
    return;
  }

  const context = prContextSchema.parse(prRecord.sourcePayload);
  await syncDecisionNotification(context, decision);
}
