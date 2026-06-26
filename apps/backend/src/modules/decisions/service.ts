import type {
  AnalyzeResponse,
  DecisionAuditAction,
  DecisionAuditEntry,
  DecisionExtractionMethod,
  DecisionListResponse,
  DecisionMemory,
  DecisionReviewReason,
  DecisionStatus,
  DecisionStats,
  PRContext
} from "@decisioncapture/shared";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { prisma } from "../database/prisma.js";
import type { DecisionMemoryRecord } from "../database/types.js";
import { createAIProvider } from "../ai/index.js";
import type { AIProvider } from "../ai/provider.js";
import { privilegedRoles, reopenRoles, type ReviewActor } from "../auth/types.js";
import { assessExplanationEvidence, MISSING_REASON } from "./evidence.js";
import { resolveDecisionStatus, scoreDecisionContext } from "./scoring.js";
import type { DecisionReopenInput, DecisionReviewUpdates, DecisionSearchOptions } from "./types.js";
import { prContextSchema } from "./validation.js";

type DecisionMemoryRecordWithLatestAudit = DecisionMemoryRecord & {
  auditLogs?: Array<{
    action: DecisionAuditAction;
    createdAt: Date;
  }>;
};

function reviewReasonForDecision(decision: {
  status: DecisionStatus;
  extractionMethod: DecisionExtractionMethod;
  reason: string;
  lastEditedByLogin?: string | null;
  auditLogs?: Array<{
    action: DecisionAuditAction;
    createdAt: Date;
  }>;
}): DecisionReviewReason {
  if (decision.status !== "PENDING") {
    return null;
  }

  const latestAuditAction = decision.auditLogs?.[0]?.action;

  if (latestAuditAction === "REOPENED") {
    return "REVIEW_REOPENED";
  }

  if (decision.reason === MISSING_REASON) {
    return "MISSING_EXPLANATION";
  }

  if (decision.extractionMethod === "STRUCTURED_FALLBACK") {
    return "STRUCTURED_FALLBACK";
  }

  if (decision.lastEditedByLogin) {
    return "AWAITING_REVIEW";
  }

  return "LOW_CONFIDENCE";
}

function toDecisionMemory(decision: DecisionMemoryRecordWithLatestAudit): DecisionMemory {
  return {
    ...decision,
    reviewReason: reviewReasonForDecision(decision),
    approvedAt: decision.approvedAt?.toISOString() ?? null,
    rejectedAt: decision.rejectedAt?.toISOString() ?? null,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString()
  };
}

function toAuditEntry(entry: {
  id: string;
  decisionId: string;
  action: DecisionAuditEntry["action"];
  actorLogin?: string | null;
  note?: string | null;
  createdAt: Date;
}): DecisionAuditEntry {
  return {
    id: entry.id,
    decisionId: entry.decisionId,
    action: entry.action,
    actorLogin: entry.actorLogin ?? null,
    note: entry.note ?? null,
    createdAt: entry.createdAt.toISOString()
  };
}

function mergedAtDate(context: PRContext) {
  return context.mergedAt ? new Date(context.mergedAt) : undefined;
}

function isMissingDecisionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function normalizeLogin(login: string | null | undefined) {
  return login?.trim().toLowerCase() ?? "";
}

function actorLogin(actor: ReviewActor) {
  return actor.user?.login ?? null;
}

function auditActorLogin(actor: ReviewActor) {
  return actor.user?.login ?? (actor.authRequired ? null : "system");
}

function decisionSnapshot(decision: DecisionMemoryRecord): Prisma.InputJsonObject {
  return {
    decision: decision.decision,
    reason: decision.reason,
    alternative: decision.alternative,
    impact: decision.impact,
    author: decision.author,
    sourcePR: decision.sourcePR,
    repository: decision.repository,
    filesChanged: decision.filesChanged,
    confidence: decision.confidence,
    status: decision.status,
    category: decision.category,
    extractionMethod: decision.extractionMethod,
    approvedByLogin: decision.approvedByLogin,
    approvedAt: decision.approvedAt?.toISOString() ?? null,
    rejectedByLogin: decision.rejectedByLogin,
    rejectedAt: decision.rejectedAt?.toISOString() ?? null,
    lastEditedByLogin: decision.lastEditedByLogin
  };
}

export class DecisionService {
  constructor(private readonly aiProvider: AIProvider = createAIProvider()) {}

  async analyzePrContext(context: PRContext): Promise<AnalyzeResponse> {
    const score = scoreDecisionContext(context, env.DECISION_SCORE_THRESHOLD);

    if (!score.shouldAnalyze) {
      return {
        status: "ignored",
        score,
        message: "PR did not cross the decision-memory threshold"
      };
    }

    const prRecord = await prisma.pullRequestRecord.upsert({
      where: {
        repository_prNumber: {
          repository: context.repository,
          prNumber: context.prNumber
        }
      },
      update: {
        title: context.title,
        description: context.description,
        mergedAt: mergedAtDate(context),
        author: context.author,
        url: context.url,
        sourcePayload: context as unknown as Prisma.InputJsonValue
      },
      create: {
        prNumber: context.prNumber,
        title: context.title,
        description: context.description,
        mergedAt: mergedAtDate(context),
        author: context.author,
        url: context.url,
        repository: context.repository,
        sourcePayload: context as unknown as Prisma.InputJsonValue
      }
    });

    const extracted = await this.aiProvider.extractDecision(context, score);
    const evidence = assessExplanationEvidence(context);
    const missingExplicitReason = !evidence.hasExplicitReason;
    const confidence = missingExplicitReason
      ? Math.min(extracted.confidence, 0.49)
      : extracted.confidence;
    const status = (
      missingExplicitReason || extracted.extractionMethod === "STRUCTURED_FALLBACK" || !env.AUTO_APPROVAL_ENABLED
        ? "PENDING"
        : resolveDecisionStatus(confidence, env.AUTO_APPROVE_CONFIDENCE)
    ) as DecisionStatus;

    const existingDecision = await prisma.decisionMemory.findFirst({
      where: { prRecordId: prRecord.id },
      orderBy: { createdAt: "asc" }
    });

    const decisionPayload = {
      decision: extracted.decision,
      reason: missingExplicitReason ? MISSING_REASON : extracted.reason,
      alternative: extracted.alternative,
      impact: extracted.impact,
      author: extracted.author,
      sourcePR: extracted.source,
      repository: context.repository,
      filesChanged: context.filesChanged,
      confidence,
      status,
      category: extracted.category,
      extractionMethod: extracted.extractionMethod,
      approvedByUserId: null,
      approvedByLogin: null,
      approvedAt: null,
      rejectedByUserId: null,
      rejectedByLogin: null,
      rejectedAt: null,
      lastEditedByUserId: null,
      lastEditedByLogin: null
    };

    const decision = await prisma.$transaction(async (tx) => {
      const storedDecision = existingDecision
        ? await tx.decisionMemory.update({
            where: { id: existingDecision.id },
            data: decisionPayload
          })
        : await tx.decisionMemory.create({
            data: {
              ...decisionPayload,
              prRecordId: prRecord.id
            }
          });

      await tx.decisionAuditLog.create({
        data: {
          decisionId: storedDecision.id,
          action: existingDecision ? "EDITED" : "CREATED",
          actorLogin: "system",
          before: existingDecision ? decisionSnapshot(existingDecision) : Prisma.JsonNull,
          after: decisionSnapshot(storedDecision)
        }
      });

      return storedDecision;
    });

    return {
      status: "processed",
      score,
      decision: toDecisionMemory(decision),
      message:
        status === "APPROVED"
          ? "Decision memory captured"
          : "Decision memory needs author review before approval"
    };
  }

  async listDecisions(options: DecisionSearchOptions): Promise<DecisionListResponse> {
    const and: Prisma.DecisionMemoryWhereInput[] = [];

    if (options.status) {
      and.push({ status: options.status });
    }

    if (options.repository) {
      and.push({ repository: options.repository });
    }

    if (options.category) {
      and.push({ category: options.category });
    }

    if (options.q) {
      and.push({
        OR: [
          { decision: { contains: options.q, mode: "insensitive" } },
          { reason: { contains: options.q, mode: "insensitive" } },
          { alternative: { contains: options.q, mode: "insensitive" } },
          { impact: { contains: options.q, mode: "insensitive" } },
          { author: { contains: options.q, mode: "insensitive" } },
          { repository: { contains: options.q, mode: "insensitive" } },
          { sourcePR: { contains: options.q, mode: "insensitive" } }
        ]
      });
    }

    const where: Prisma.DecisionMemoryWhereInput = and.length > 0 ? { AND: and } : {};
    const orderBy: Prisma.DecisionMemoryOrderByWithRelationInput =
      options.sort === "confidence"
        ? { confidence: "desc" }
        : options.sort === "oldest"
          ? { createdAt: "asc" }
          : { createdAt: "desc" };

    const [decisions, total] = await Promise.all([
      prisma.decisionMemory.findMany({
        where,
        orderBy,
        skip: options.offset ?? 0,
        take: options.limit ?? 30,
        include: {
          auditLogs: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }),
      prisma.decisionMemory.count({ where })
    ]);

    return {
      decisions: decisions.map(toDecisionMemory),
      total
    };
  }

  async getDecision(id: string): Promise<DecisionMemory | null> {
    const decision = await prisma.decisionMemory.findUnique({
      where: { id },
      include: {
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    return decision ? toDecisionMemory(decision) : null;
  }

  async listAuditLogs(id: string): Promise<DecisionAuditEntry[]> {
    const [decision, auditLogs] = await Promise.all([
      prisma.decisionMemory.findUnique({
        where: { id },
        select: { id: true }
      }),
      prisma.decisionAuditLog.findMany({
        where: { decisionId: id },
        orderBy: { createdAt: "desc" }
      })
    ]);

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    return auditLogs.map(toAuditEntry);
  }

  private contextFromDecision(decision: {
    prRecord?: {
      sourcePayload: Prisma.JsonValue | null;
    } | null;
  }) {
    const parsed = prContextSchema.safeParse(decision.prRecord?.sourcePayload);
    return parsed.success ? parsed.data : null;
  }

  private ensureCanReview(
    decision: DecisionMemoryRecord & {
      prRecord?: {
        sourcePayload: Prisma.JsonValue | null;
      } | null;
    },
    actor: ReviewActor
  ) {
    if (!actor.authRequired) {
      return;
    }

    if (!actor.user) {
      throw new HttpError(401, "GitHub sign-in is required to review decisions");
    }

    if (privilegedRoles.includes(actor.user.role)) {
      return;
    }

    const context = this.contextFromDecision(decision);
    const allowedLogins = new Set(
      [
        decision.author,
        context?.author,
        ...(context?.reviewers ?? []),
        ...(context?.approvals ?? [])
      ]
        .map(normalizeLogin)
        .filter(Boolean)
    );

    if (!allowedLogins.has(normalizeLogin(actor.user.login))) {
      throw new HttpError(
        403,
        "Only the PR author, reviewer, approver, or a DecisionCapture reviewer can review this decision"
      );
    }
  }

  private async requirePendingDecision(
    id: string,
    action: "edit" | "approve" | "reject",
    actor: ReviewActor
  ) {
    const actionLabel =
      action === "edit" ? "edited" : action === "approve" ? "approved" : "rejected";
    const decision = await prisma.decisionMemory.findUnique({
      where: { id },
      include: { prRecord: true }
    });

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    if (decision.status !== "PENDING") {
      throw new HttpError(409, `Only pending decisions can be ${actionLabel}`);
    }

    this.ensureCanReview(decision, actor);
    return decision;
  }

  private ensureCanReopen(actor: ReviewActor) {
    if (!actor.authRequired) {
      return;
    }

    if (!actor.user) {
      throw new HttpError(401, "GitHub sign-in is required to reopen decisions");
    }

    if (!reopenRoles.includes(actor.user.role)) {
      throw new HttpError(403, "Only an admin or maintainer can reopen a completed review");
    }
  }

  async updateDecision(
    id: string,
    updates: DecisionReviewUpdates,
    actor: ReviewActor = { authRequired: false }
  ): Promise<DecisionMemory> {
    const existingDecision = await this.requirePendingDecision(id, "edit", actor);
    const login = actorLogin(actor);

    try {
      const decision = await prisma.$transaction(async (tx) => {
        const updatedDecision = await tx.decisionMemory.update({
          where: { id },
          data: {
            ...updates,
            lastEditedByUserId: actor.user?.id ?? null,
            lastEditedByLogin: login
          }
        });

        await tx.decisionAuditLog.create({
          data: {
            decisionId: id,
            action: "EDITED",
            actorUserId: actor.user?.id,
            actorLogin: auditActorLogin(actor),
            before: decisionSnapshot(existingDecision),
            after: decisionSnapshot(updatedDecision)
          }
        });

        return updatedDecision;
      });

      return toDecisionMemory(decision);
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async approveDecision(
    id: string,
    updates: DecisionReviewUpdates,
    actor: ReviewActor = { authRequired: false }
  ): Promise<DecisionMemory> {
    const existingDecision = await this.requirePendingDecision(id, "approve", actor);
    const login = actorLogin(actor);

    try {
      const decision = await prisma.$transaction(async (tx) => {
        const approvedAt = new Date();
        const updatedDecision = await tx.decisionMemory.update({
          where: { id },
          data: {
            ...updates,
            status: "APPROVED",
            approvedByUserId: actor.user?.id ?? null,
            approvedByLogin: login,
            approvedAt,
            rejectedByUserId: null,
            rejectedByLogin: null,
            rejectedAt: null,
            lastEditedByUserId: actor.user?.id ?? null,
            lastEditedByLogin: login
          }
        });

        await tx.decisionAuditLog.create({
          data: {
            decisionId: id,
            action: "APPROVED",
            actorUserId: actor.user?.id,
            actorLogin: auditActorLogin(actor),
            before: decisionSnapshot(existingDecision),
            after: decisionSnapshot(updatedDecision)
          }
        });

        return updatedDecision;
      });

      return toDecisionMemory(decision);
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async rejectDecision(
    id: string,
    actor: ReviewActor = { authRequired: false }
  ): Promise<DecisionMemory> {
    const existingDecision = await this.requirePendingDecision(id, "reject", actor);
    const login = actorLogin(actor);

    try {
      const decision = await prisma.$transaction(async (tx) => {
        const rejectedAt = new Date();
        const updatedDecision = await tx.decisionMemory.update({
          where: { id },
          data: {
            status: "REJECTED",
            rejectedByUserId: actor.user?.id ?? null,
            rejectedByLogin: login,
            rejectedAt
          }
        });

        await tx.decisionAuditLog.create({
          data: {
            decisionId: id,
            action: "REJECTED",
            actorUserId: actor.user?.id,
            actorLogin: auditActorLogin(actor),
            before: decisionSnapshot(existingDecision),
            after: decisionSnapshot(updatedDecision)
          }
        });

        return updatedDecision;
      });

      return toDecisionMemory(decision);
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async reopenDecision(
    id: string,
    input: DecisionReopenInput,
    actor: ReviewActor = { authRequired: false }
  ): Promise<DecisionMemory> {
    const existingDecision = await prisma.decisionMemory.findUnique({ where: { id } });

    if (!existingDecision) {
      throw new HttpError(404, "Decision not found");
    }

    if (existingDecision.status === "PENDING") {
      throw new HttpError(409, "This decision is already pending review");
    }

    this.ensureCanReopen(actor);

    try {
      const decision = await prisma.$transaction(async (tx) => {
        const reopenedDecision = await tx.decisionMemory.update({
          where: { id },
          data: {
            status: "PENDING",
            approvedByUserId: null,
            approvedByLogin: null,
            approvedAt: null,
            rejectedByUserId: null,
            rejectedByLogin: null,
            rejectedAt: null
          }
        });

        await tx.decisionAuditLog.create({
          data: {
            decisionId: id,
            action: "REOPENED",
            actorUserId: actor.user?.id,
            actorLogin: auditActorLogin(actor),
            note: input.reason,
            before: decisionSnapshot(existingDecision),
            after: decisionSnapshot(reopenedDecision)
          }
        });

        return reopenedDecision;
      });

      return toDecisionMemory({
        ...decision,
        auditLogs: [{ action: "REOPENED", createdAt: new Date() }]
      });
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async stats(): Promise<DecisionStats> {
    const [totalDecisions, pendingDecisions, approvedDecisions, rejectedDecisions, categories, recentDecisions] =
      await Promise.all([
        prisma.decisionMemory.count(),
        prisma.decisionMemory.count({ where: { status: "PENDING" } }),
        prisma.decisionMemory.count({ where: { status: "APPROVED" } }),
        prisma.decisionMemory.count({ where: { status: "REJECTED" } }),
        prisma.decisionMemory.groupBy({
          by: ["category"],
          _count: { category: true },
          orderBy: { _count: { category: "desc" } }
        }),
        prisma.decisionMemory.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            auditLogs: {
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        })
      ]);

    return {
      totalDecisions,
      pendingDecisions,
      approvedDecisions,
      rejectedDecisions,
      categories: categories.map((item) => ({
        category: item.category,
        count: item._count.category
      })),
      recentDecisions: recentDecisions.map(toDecisionMemory)
    };
  }
}

export const decisionService = new DecisionService();
