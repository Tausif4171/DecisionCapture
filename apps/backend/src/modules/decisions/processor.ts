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
    logger.error({ err: error, decisionId: decision.id, prNumber: context.prNumber }, "Failed to sync PR review comment");
  }
}

async function autoLinkDecisionContext(context: PRContext, decision: DecisionMemory) {
  try {
    const { autoLinkGitHubIssueReferences } = await import("../contexts/auto-link.service.js");
    await autoLinkGitHubIssueReferences(decision.id, context);
  } catch (error) {
    logger.error(
      { error, decisionId: decision.id, prNumber: context.prNumber },
      "Automatic GitHub issue linking failed"
    );
  }
}

export async function scheduleRelationshipAnalysisForApprovedDecision(decision: DecisionMemory) {
  if (decision.status !== "APPROVED") {
    return;
  }

  try {
    const { scheduleRelationshipAnalysis } = await import("../relationships/queue.js");
    await scheduleRelationshipAnalysis(decision.id);
  } catch (error) {
    logger.error(
      { error, decisionId: decision.id },
      "Decision relationship analysis could not be scheduled"
    );
  }
}

export async function invalidateRelationshipsForReopenedDecision(decisionId: string) {
  try {
    const { decisionRelationshipService } = await import("../relationships/service.js");
    await decisionRelationshipService.invalidateForReopenedDecision(decisionId);
  } catch (error) {
    logger.error(
      { error, decisionId },
      "Decision relationships could not be invalidated after review reopening"
    );
  }
}

export async function scheduleRelationshipAnalysisForApprovedDependents(decisionId: string) {
  try {
    const [{ decisionRelationshipService }, { scheduleRelationshipAnalysis }] = await Promise.all([
      import("../relationships/service.js"),
      import("../relationships/queue.js")
    ]);
    const sourceDecisionIds =
      await decisionRelationshipService.staleApprovedSourcesForTarget(decisionId);

    for (const sourceDecisionId of sourceDecisionIds) {
      await scheduleRelationshipAnalysis(sourceDecisionId);
    }
  } catch (error) {
    logger.error(
      { error, decisionId },
      "Dependent decision relationship analyses could not be scheduled"
    );
  }
}

export async function processDecisionContext(context: PRContext): Promise<AnalyzeResponse> {
  const result = await decisionService.analyzePrContext(context);

  if (result.status !== "processed" || !result.decision) {
    return result;
  }

  await autoLinkDecisionContext(context, result.decision);
  await syncDecisionNotification(context, result.decision);
  await scheduleRelationshipAnalysisForApprovedDecision(result.decision);
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
