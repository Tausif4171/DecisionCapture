import { Prisma } from "@prisma/client";
import type {
  ConflictOverview,
  ConflictScan as SharedConflictScan,
  DecisionConflict as SharedDecisionConflict,
  PRContext
} from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../middleware/error.js";
import { privilegedRoles, type ReviewActor } from "../auth/types.js";
import { prisma } from "../database/prisma.js";
import { enrichWebhookToPRContext } from "../github/service.js";
import { githubPullRequestWebhookSchema } from "../github/validation.js";
import { buildConflictPrText, contentHash } from "./text.js";
import { retrieveConflictCandidates } from "./candidates.js";
import { rankCandidatesByEmbedding } from "./embedding.js";
import { OllamaConflictAnalyzer } from "./analyzer.js";
import { logConflictFeedbackFailure, syncConflictFeedback } from "./github-feedback.js";
import type { ConflictPullRequestContext, ConflictReviewAction } from "./types.js";

type ConflictWithDecision = Prisma.DecisionConflictGetPayload<{
  include: { decision: true; pullRequestRecord: true };
}>;

type ConflictScanRecord = Prisma.ConflictScanGetPayload<{ select: { id: true; repository: true; prNumber: true; headSha: true; contentHash: true; status: true; candidateCount: true; conflictCount: true; error: true; lastAttemptAt: true; lastSuccessAt: true; createdAt: true; updatedAt: true } }>;

function actorLogin(actor: ReviewActor) {
  return actor.user?.login ?? (actor.authRequired ? null : "system");
}

function canManage(actor: ReviewActor) {
  return !actor.authRequired || Boolean(actor.user && privilegedRoles.includes(actor.user.role));
}

function ensureCanManage(actor: ReviewActor) {
  if (!actor.authRequired) {
    return;
  }

  if (!actor.user) {
    throw new HttpError(401, "GitHub sign-in is required to manage conflicts");
  }

  if (!privilegedRoles.includes(actor.user.role)) {
    throw new HttpError(403, "Only an admin, maintainer, or reviewer can manage conflicts");
  }
}

function allowedRepository(repository: string) {
  const configured = configuredRepositories();

  return !configured.length || configured.includes(repository.toLowerCase());
}

function configuredRepositories() {
  return env.CONFLICT_DETECTION_REPOSITORIES
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function repositoryWhere(repository?: string) {
  if (repository) {
    return allowedRepository(repository) ? { repository } : { repository: "__outside_allowlist__" };
  }

  const configured = configuredRepositories();
  return configured.length
    ? {
        OR: configured.map((value) => ({
          repository: { equals: value, mode: "insensitive" as const }
        }))
      }
    : {};
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 500) || "Conflict analysis failed";
}

function toScan(scan: ConflictScanRecord): SharedConflictScan {
  return {
    id: scan.id,
    repository: scan.repository,
    prNumber: scan.prNumber,
    headSha: scan.headSha,
    contentHash: scan.contentHash,
    status: scan.status,
    candidateCount: scan.candidateCount,
    conflictCount: scan.conflictCount,
    error: scan.error,
    lastAttemptAt: scan.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: scan.lastSuccessAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString()
  };
}

function toConflict(conflict: ConflictWithDecision): SharedDecisionConflict {
  return {
    id: conflict.id,
    scanId: conflict.scanId,
    pullRequestRecordId: conflict.pullRequestRecordId,
    decisionId: conflict.decisionId,
    repository: conflict.repository,
    prNumber: conflict.prNumber,
    prUrl: conflict.prUrl,
    prTitle: conflict.prTitle,
    pullRequestState: conflict.pullRequestRecord.state,
    headSha: conflict.headSha,
    similarityScore: conflict.similarityScore,
    confidence: conflict.confidence,
    explanation: conflict.explanation,
    evidence: conflict.evidence,
    matchMethod: conflict.matchMethod,
    status: conflict.status,
    historicalDecision: {
      id: conflict.decision.id,
      decision: conflict.decision.decision,
      reason: conflict.decision.reason,
      status: conflict.decision.status,
      category: conflict.decision.category,
      sourcePR: conflict.decision.sourcePR,
      repository: conflict.decision.repository,
      createdAt: conflict.decision.createdAt.toISOString()
    },
    reviewedByLogin: conflict.reviewedByLogin,
    reviewedAt: conflict.reviewedAt?.toISOString() ?? null,
    reviewNote: conflict.reviewNote,
    createdAt: conflict.createdAt.toISOString(),
    updatedAt: conflict.updatedAt.toISOString()
  };
}

type ConflictFeedbackWithDecision = Prisma.DecisionConflictGetPayload<{
  include: { decision: true };
}>;

function feedbackConflict(conflict: ConflictFeedbackWithDecision) {
  return {
    id: conflict.id,
    decisionId: conflict.decisionId,
    repository: conflict.repository,
    prNumber: conflict.prNumber,
    prUrl: conflict.prUrl,
    prTitle: conflict.prTitle,
    similarityScore: conflict.similarityScore,
    confidence: conflict.confidence,
    explanation: conflict.explanation,
    evidence: conflict.evidence,
    status: conflict.status,
    decision: {
      decision: conflict.decision.decision,
      reason: conflict.decision.reason,
      status: conflict.decision.status
    }
  };
}

function conflictContext(context: PRContext, fallbackHeadSha: string): ConflictPullRequestContext {
  return {
    ...context,
    action: context.action ?? "opened",
    state: context.state ?? (context.mergedAt ? "CLOSED" : "OPEN"),
    draft: context.draft ?? false,
    headSha: context.headSha ?? fallbackHeadSha
  };
}

export class ConflictService {
  private readonly analyzer = new OllamaConflictAnalyzer();

  async receiveWebhook(eventType: string, deliveryId: string, payload: Record<string, unknown>) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      return { status: "disabled" as const };
    }

    try {
      const event = await prisma.webhookEvent.create({
        data: {
          provider: "GITHUB",
          externalDeliveryId: deliveryId,
          eventType: `conflict:${eventType}`,
          payload: payload as Prisma.InputJsonObject,
          status: "QUEUED"
        },
        select: { id: true }
      });

      try {
        const { enqueueConflictWebhook } = await import("./queue.js");
        await enqueueConflictWebhook(event.id);
      } catch (error) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", lastError: errorMessage(error) }
        });
        throw error;
      }

      return { status: "queued" as const, webhookEventId: event.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { status: "duplicate" as const };
      }
      throw error;
    }
  }

  async processWebhook(webhookEventId: string) {
    const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      throw new HttpError(404, "Conflict webhook event not found");
    }

    if (event.status === "PROCESSED") {
      return { status: "processed" as const };
    }

    const payload = githubPullRequestWebhookSchema.parse(event.payload);
    const context = conflictContext(
      await enrichWebhookToPRContext(payload),
      `event-${webhookEventId}`
    );

    if (!allowedRepository(context.repository)) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null }
      });
      return { status: "skipped" as const };
    }

    try {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "QUEUED", attempts: { increment: 1 }, lastError: null }
      });

      const record = await this.upsertPullRequest(context);

      if (context.state === "CLOSED" || context.action === "closed") {
        await this.resolveOpenConflicts(record.id, "Pull request closed; active warnings are no longer actionable.");
        await this.syncLatestScan(record.id);
      } else if (context.draft && context.action !== "ready_for_review") {
        await prisma.webhookEvent.update({
          where: { id: webhookEventId },
          data: { status: "PROCESSED", processedAt: new Date(), lastError: null }
        });
        return { status: "skipped" as const };
      } else {
        const scan = await this.createScan(record.id, context);
        if (scan.shouldStart) {
          const { scheduleConflictScan } = await import("./queue.js");
          await scheduleConflictScan(scan.scan.id);
        }
      }

      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null }
      });
      return { status: "processed" as const };
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: "FAILED", lastError: errorMessage(error) }
      });
      throw error;
    }
  }

  private async upsertPullRequest(context: ConflictPullRequestContext) {
    const text = buildConflictPrText(context);
    const hash = contentHash(text);
    const mergedAt = context.mergedAt ? new Date(context.mergedAt) : null;

    return prisma.pullRequestRecord.upsert({
      where: {
        repository_prNumber: {
          repository: context.repository,
          prNumber: context.prNumber
        }
      },
      update: {
        title: context.title,
        description: context.description ?? null,
        mergedAt,
        author: context.author,
        url: context.url,
        sourcePayload: context as unknown as Prisma.InputJsonValue,
        state: context.state,
        isDraft: context.draft,
        baseBranch: context.baseBranch ?? null,
        headSha: context.headSha,
        contentHash: hash
      },
      create: {
        prNumber: context.prNumber,
        title: context.title,
        description: context.description ?? null,
        mergedAt,
        author: context.author,
        url: context.url,
        repository: context.repository,
        sourcePayload: context as unknown as Prisma.InputJsonValue,
        state: context.state,
        isDraft: context.draft,
        baseBranch: context.baseBranch ?? null,
        headSha: context.headSha,
        contentHash: hash
      }
    });
  }

  private async createScan(pullRequestRecordId: string, context: ConflictPullRequestContext) {
    const hash = contentHash(buildConflictPrText(context));
    const existing = await prisma.conflictScan.upsert({
      where: {
        repository_prNumber_headSha_contentHash: {
          repository: context.repository,
          prNumber: context.prNumber,
          headSha: context.headSha,
          contentHash: hash
        }
      },
      create: {
        pullRequestRecordId,
        repository: context.repository,
        prNumber: context.prNumber,
        headSha: context.headSha,
        contentHash: hash,
        status: "PENDING"
      },
      update: {}
    });

    const shouldRestart = context.action === "reopened" && existing.status !== "RUNNING";
    const scan = shouldRestart
      ? await prisma.conflictScan.update({
          where: { id: existing.id },
          data: { status: "PENDING", error: null, lastAttemptAt: null }
        })
      : existing;

    await this.markOldConflictsStale(
      pullRequestRecordId,
      context.headSha,
      hash,
      context.action === "reopened"
    );
    return { scan, shouldStart: scan.status !== "RUNNING" && scan.status !== "COMPLETED" };
  }

  private async markOldConflictsStale(
    pullRequestRecordId: string,
    headSha: string,
    hash: string,
    force: boolean
  ) {
    const previous = await prisma.decisionConflict.findMany({
      where: {
        pullRequestRecordId,
        status: "OPEN",
        ...(force ? {} : { OR: [{ headSha: { not: headSha } }, { scan: { contentHash: { not: hash } } }] })
      },
      select: { id: true, status: true }
    });

    if (!previous.length) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const conflict of previous) {
        await tx.decisionConflict.update({ where: { id: conflict.id }, data: { status: "STALE" } });
        await tx.conflictAuditLog.create({
          data: {
            conflictId: conflict.id,
            action: "STALE",
            actorLogin: "system",
            note: "A newer PR snapshot requires a fresh conflict analysis.",
            before: { status: conflict.status },
            after: { status: "STALE", headSha }
          }
        });
      }
    });
  }

  private async resolveOpenConflicts(pullRequestRecordId: string, note: string) {
    const conflicts = await prisma.decisionConflict.findMany({
      where: { pullRequestRecordId, status: "OPEN" },
      select: { id: true, status: true }
    });
    if (!conflicts.length) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const conflict of conflicts) {
        await tx.decisionConflict.update({ where: { id: conflict.id }, data: { status: "RESOLVED" } });
        await tx.conflictAuditLog.create({
          data: {
            conflictId: conflict.id,
            action: "RESOLVED",
            actorLogin: "system",
            note,
            before: { status: conflict.status },
            after: { status: "RESOLVED" }
          }
        });
      }
    });
  }

  async runScan(scanId: string) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      throw new HttpError(409, "Conflict detection is not enabled");
    }

    const claimed = await prisma.conflictScan.updateMany({
      where: { id: scanId, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "RUNNING", lastAttemptAt: new Date(), error: null }
    });
    const scan = await prisma.conflictScan.findUnique({
      where: { id: scanId },
      include: { pullRequestRecord: true }
    });

    if (!scan) {
      throw new HttpError(404, "Conflict scan not found");
    }

    if (!claimed.count) {
      return toScan(scan);
    }

    const startedAt = Date.now();
    logger.info(
      {
        metric: "conflict_scan_started",
        scanId,
        repository: scan.repository,
        prNumber: scan.prNumber,
        headSha: scan.headSha
      },
      "Conflict scan started"
    );

    try {
      await this.syncFeedbackForScan(scan);
      const storedContext = (scan.pullRequestRecord.sourcePayload ?? {}) as Record<string, unknown>;
      const context = conflictContext(
        storedContext as unknown as PRContext,
        scan.headSha
      );
      const lexicalCandidates = await retrieveConflictCandidates(context);
      const candidates = await rankCandidatesByEmbedding(context, lexicalCandidates);
      logger.info(
        {
          metric: "conflict_candidates_ranked",
          scanId,
          repository: scan.repository,
          prNumber: scan.prNumber,
          lexicalCandidateCount: lexicalCandidates.length,
          candidateCount: candidates.length
        },
        "Conflict candidates ranked"
      );
      const assessments = await this.analyzer.analyze(context, candidates);
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const valid = assessments.filter(
        (assessment) =>
          assessment.confidence >= env.CONFLICT_CONFIDENCE_THRESHOLD &&
          byId.has(assessment.decisionId) &&
          assessment.evidenceFromPr.length > 0 &&
          assessment.evidenceFromDecision.length > 0
      );

      const result = await prisma.$transaction(async (tx) => {
        const dismissed = await tx.decisionConflict.findMany({
          where: {
            scanId,
            decisionId: { in: valid.map((assessment) => assessment.decisionId) },
            status: "DISMISSED"
          },
          select: { decisionId: true }
        });
        const dismissedIds = new Set(dismissed.map((conflict) => conflict.decisionId));
        let persistedConflictCount = 0;

        for (const assessment of valid) {
          const candidate = byId.get(assessment.decisionId);
          if (!candidate || dismissedIds.has(candidate.id)) {
            continue;
          }

          persistedConflictCount += 1;

          const conflict = await tx.decisionConflict.upsert({
            where: {
              scanId_decisionId: {
                scanId,
                decisionId: candidate.id
              }
            },
            create: {
              scanId,
              pullRequestRecordId: scan.pullRequestRecordId,
              decisionId: candidate.id,
              repository: context.repository,
              prNumber: context.prNumber,
              prUrl: context.url,
              prTitle: context.title,
              headSha: scan.headSha,
              similarityScore: candidate.similarityScore ?? 0,
              confidence: assessment.confidence,
              explanation: assessment.explanation,
              evidence: [...assessment.evidenceFromPr, ...assessment.evidenceFromDecision],
              matchMethod: candidate.matchMethod ?? "HYBRID",
              status: "OPEN"
            },
            update: {
              similarityScore: candidate.similarityScore ?? 0,
              confidence: assessment.confidence,
              explanation: assessment.explanation,
              evidence: [...assessment.evidenceFromPr, ...assessment.evidenceFromDecision],
              matchMethod: candidate.matchMethod ?? "HYBRID",
              status: "OPEN",
              reviewedByUserId: null,
              reviewedByLogin: null,
              reviewedAt: null,
              reviewNote: null
            },
            include: { decision: true, pullRequestRecord: true }
          });

          await tx.conflictAuditLog.create({
            data: {
              conflictId: conflict.id,
              action: "DETECTED",
              actorLogin: "system",
              note: "Potential conflict detected from bounded historical candidates.",
              after: { confidence: assessment.confidence, similarityScore: candidate.similarityScore }
            }
          });
        }

        const updatedScan = await tx.conflictScan.update({
          where: { id: scanId },
          data: {
            status: "COMPLETED",
            candidateCount: candidates.length,
            conflictCount: persistedConflictCount,
            lastSuccessAt: new Date(),
            error: null
          },
          include: { pullRequestRecord: true }
        });

        await tx.pullRequestRecord.update({
          where: { id: scan.pullRequestRecordId },
          data: { lastConflictScanAt: new Date() }
        });

        return updatedScan;
      });

      await this.syncFeedbackForScan(result);
      logger.info(
        {
          metric: "conflict_scan_completed",
          scanId,
          repository: scan.repository,
          prNumber: scan.prNumber,
          candidateCount: candidates.length,
          conflictCount: valid.length,
          durationMs: Date.now() - startedAt
        },
        "Conflict scan completed"
      );
      return toScan(result);
    } catch (error) {
      const failed = await prisma.conflictScan.update({
        where: { id: scanId },
        data: { status: "FAILED", error: errorMessage(error), lastAttemptAt: new Date() },
        include: { pullRequestRecord: true }
      });
      try {
        await this.syncFeedbackForScan(failed);
      } catch (feedbackError) {
        logConflictFeedbackFailure(feedbackError, toScan(failed));
      }
      logger.error(
        {
          err: error,
          metric: "conflict_scan_failed",
          scanId,
          repository: scan.repository,
          prNumber: scan.prNumber,
          durationMs: Date.now() - startedAt
        },
        "Conflict scan failed"
      );
      throw error;
    }
  }

  private async syncFeedbackForScan(scan: ConflictScanRecord) {
    if (env.CONFLICT_SHADOW_MODE || (!env.CONFLICT_CHECK_ENABLED && !env.CONFLICT_COMMENT_ENABLED)) {
      return;
    }

    const conflicts = await prisma.decisionConflict.findMany({
      where: { scanId: scan.id, status: "OPEN" },
      include: { decision: true }
    });

    try {
      await syncConflictFeedback(toScan(scan), conflicts.map(feedbackConflict));
      await prisma.$transaction(
        conflicts.map((conflict) =>
          prisma.conflictAuditLog.create({
            data: {
              conflictId: conflict.id,
              action: "CHECK_UPDATED",
              actorLogin: "system",
              note: "GitHub conflict feedback synchronized."
            }
          })
        )
      );
      logger.info(
        {
          metric: "conflict_feedback_synced",
          scanId: scan.id,
          repository: scan.repository,
          prNumber: scan.prNumber,
          conflictCount: conflicts.length
        },
        "Conflict feedback synchronized"
      );
    } catch (error) {
      logConflictFeedbackFailure(error, toScan(scan));
    }
  }

  private async syncLatestScan(pullRequestRecordId: string) {
    const scan = await prisma.conflictScan.findFirst({
      where: { pullRequestRecordId },
      orderBy: { createdAt: "desc" }
    });

    if (scan) {
      await this.syncFeedbackForScan(scan);
    }
  }

  async overviewForDecision(decisionId: string, actor: ReviewActor): Promise<ConflictOverview> {
    const decision = await prisma.decisionMemory.findUnique({
      where: { id: decisionId },
      select: { id: true, repository: true }
    });
    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    if (!env.CONFLICT_DETECTION_ENABLED) {
      return { enabled: false, canManage: canManage(actor), conflicts: [], scans: [] };
    }

    if (!allowedRepository(decision.repository)) {
      return { enabled: true, canManage: canManage(actor), conflicts: [], scans: [] };
    }

    const [conflicts, scans] = await Promise.all([
      prisma.decisionConflict.findMany({
        where: { ...repositoryWhere(decision.repository), decisionId, status: { in: ["OPEN", "DISMISSED", "RESOLVED", "STALE"] } },
        include: { decision: true, pullRequestRecord: true },
        orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }]
      }),
      prisma.conflictScan.findMany({
        where: { ...repositoryWhere(decision.repository), conflicts: { some: { decisionId } } },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    return {
      enabled: true,
      canManage: canManage(actor),
      conflicts: conflicts.map(toConflict),
      scans: scans.map(toScan)
    };
  }

  async list(actor: ReviewActor, query: { repository?: string; status?: string; prNumber?: number } = {}) {
    const allowedStatuses = new Set(["OPEN", "DISMISSED", "RESOLVED", "STALE"]);
    if (query.status && !allowedStatuses.has(query.status)) {
      throw new HttpError(400, "Invalid conflict status");
    }

    if (!env.CONFLICT_DETECTION_ENABLED) {
      return { enabled: false, canManage: canManage(actor), conflicts: [] };
    }

    const status = query.status;
    const conflicts = await prisma.decisionConflict.findMany({
      where: {
        ...repositoryWhere(query.repository),
        ...(status ? { status: status as "OPEN" | "DISMISSED" | "RESOLVED" | "STALE" } : {}),
        ...(query.prNumber ? { prNumber: query.prNumber } : {})
      },
      include: { decision: true, pullRequestRecord: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100
    });

    return { enabled: env.CONFLICT_DETECTION_ENABLED, canManage: canManage(actor), conflicts: conflicts.map(toConflict) };
  }

  async get(conflictId: string) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      throw new HttpError(409, "Conflict detection is not enabled");
    }

    const conflict = await prisma.decisionConflict.findUnique({
      where: { id: conflictId },
      include: { decision: true, pullRequestRecord: true }
    });
    if (!conflict) {
      throw new HttpError(404, "Conflict not found");
    }

    if (!allowedRepository(conflict.repository)) {
      throw new HttpError(404, "Conflict not found");
    }

    return toConflict(conflict);
  }

  async getScan(scanId: string) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      throw new HttpError(409, "Conflict detection is not enabled");
    }

    const scan = await prisma.conflictScan.findUnique({ where: { id: scanId } });
    if (!scan) {
      throw new HttpError(404, "Conflict scan not found");
    }

    if (!allowedRepository(scan.repository)) {
      throw new HttpError(404, "Conflict scan not found");
    }

    return toScan(scan);
  }

  async invalidateForReopenedDecision(decisionId: string) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      return;
    }

    const conflicts = await prisma.decisionConflict.findMany({
      where: { decisionId, status: "OPEN" },
      select: { id: true, status: true, repository: true }
    });
    const eligible = conflicts.filter((conflict) => allowedRepository(conflict.repository));
    if (!eligible.length) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const conflict of eligible) {
        await tx.decisionConflict.update({
          where: { id: conflict.id },
          data: { status: "STALE" }
        });
        await tx.conflictAuditLog.create({
          data: {
            conflictId: conflict.id,
            action: "STALE",
            actorLogin: "system",
            note: "Conflict requires reassessment because the historical decision was reopened.",
            before: { status: conflict.status },
            after: { status: "STALE", reopenedDecisionId: decisionId }
          }
        });
      }
    });
  }

  async review(conflictId: string, action: ConflictReviewAction, note: string | undefined, actor: ReviewActor) {
    if (!env.CONFLICT_DETECTION_ENABLED) {
      throw new HttpError(409, "Conflict detection is not enabled");
    }

    ensureCanManage(actor);
    const current = await prisma.decisionConflict.findUnique({
      where: { id: conflictId },
      include: { decision: true, pullRequestRecord: true }
    });
    if (!current) {
      throw new HttpError(404, "Conflict not found");
    }

    if (!allowedRepository(current.repository)) {
      throw new HttpError(404, "Conflict not found");
    }

    const status = action === "dismiss" ? "DISMISSED" : "RESOLVED";
    if (current.status === status) {
      return toConflict(current);
    }
    if (current.status !== "OPEN") {
      throw new HttpError(409, "Only open conflicts can be reviewed");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const conflict = await tx.decisionConflict.update({
        where: { id: conflictId },
        data: {
          status,
          reviewedByUserId: actor.user?.id ?? null,
          reviewedByLogin: actorLogin(actor),
          reviewedAt: new Date(),
          reviewNote: note ?? null
        },
        include: { decision: true, pullRequestRecord: true }
      });

      await tx.conflictAuditLog.create({
        data: {
          conflictId,
          action: status,
          actorUserId: actor.user?.id,
          actorLogin: actorLogin(actor),
          note,
          before: { status: current.status },
          after: { status, decisionId: current.decisionId }
        }
      });

      return conflict;
    });

    const scan = await prisma.conflictScan.findUnique({ where: { id: current.scanId } });
    if (scan) {
      await this.syncFeedbackForScan(scan);
    }

    return toConflict(updated);
  }
}

export const conflictService = new ConflictService();
