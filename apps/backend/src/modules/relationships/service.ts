import type {
  DecisionRelationship as SharedDecisionRelationship,
  DecisionRelationshipAnalysis as SharedDecisionRelationshipAnalysis,
  DecisionRelationshipOverview
} from "@decisioncapture/shared";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { privilegedRoles, type ReviewActor } from "../auth/types.js";
import { prisma } from "../database/prisma.js";
import { selectRelationshipCandidates } from "./candidates.js";
import { createRelationshipReasoningProvider } from "./provider.js";
import {
  RELATIONSHIP_ANALYSIS_VERSION,
  type RelationshipReasoningProvider
} from "./types.js";
import { minimumRelationshipConfidence } from "./validation.js";

type RelationshipWithDecisions = Prisma.DecisionRelationshipGetPayload<{
  include: {
    sourceDecision: true;
    targetDecision: true;
  };
}>;

type AnalysisRecord = {
  status: SharedDecisionRelationshipAnalysis["status"];
  analysisVersion: string;
  candidateCount: number;
  suggestionCount: number;
  requestedByLogin: string | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  error: string | null;
  updatedAt: Date;
};

function actorLogin(actor: ReviewActor) {
  return actor.user?.login ?? (actor.authRequired ? null : "system");
}

function canManageRelationships(actor: ReviewActor) {
  if (!actor.authRequired) {
    return true;
  }

  return Boolean(actor.user && privilegedRoles.includes(actor.user.role));
}

function ensureCanManageRelationships(actor: ReviewActor) {
  if (!actor.authRequired) {
    return;
  }

  if (!actor.user) {
    throw new HttpError(401, "GitHub sign-in is required to review decision relationships");
  }

  if (!privilegedRoles.includes(actor.user.role)) {
    throw new HttpError(403, "Only an admin, maintainer, or reviewer can manage decision relationships");
  }
}

function toAnalysis(record: AnalysisRecord): SharedDecisionRelationshipAnalysis {
  return {
    status: record.status,
    analysisVersion: record.analysisVersion,
    candidateCount: record.candidateCount,
    suggestionCount: record.suggestionCount,
    requestedByLogin: record.requestedByLogin,
    lastAttemptAt: record.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: record.lastSuccessAt?.toISOString() ?? null,
    error: record.error,
    updatedAt: record.updatedAt.toISOString()
  };
}

function relatedDecisionSummary(decision: RelationshipWithDecisions["sourceDecision"]) {
  return {
    id: decision.id,
    decision: decision.decision,
    reason: decision.reason,
    impact: decision.impact,
    category: decision.category,
    repository: decision.repository,
    sourcePR: decision.sourcePR,
    createdAt: decision.createdAt.toISOString()
  };
}

function toRelationship(
  relationship: RelationshipWithDecisions,
  viewedDecisionId: string
): SharedDecisionRelationship {
  const outgoing = relationship.sourceDecisionId === viewedDecisionId;

  return {
    id: relationship.id,
    sourceDecisionId: relationship.sourceDecisionId,
    targetDecisionId: relationship.targetDecisionId,
    type: relationship.type,
    status: relationship.status,
    confidence: relationship.confidence,
    explanation: relationship.explanation,
    evidence: relationship.evidence,
    analysisVersion: relationship.analysisVersion,
    direction: outgoing ? "OUTGOING" : "INCOMING",
    relatedDecision: relatedDecisionSummary(
      outgoing ? relationship.targetDecision : relationship.sourceDecision
    ),
    reviewedByLogin: relationship.reviewedByLogin,
    reviewedAt: relationship.reviewedAt?.toISOString() ?? null,
    reviewNote: relationship.reviewNote,
    createdAt: relationship.createdAt.toISOString(),
    updatedAt: relationship.updatedAt.toISOString()
  };
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 500) || "Relationship analysis failed";
}

export class DecisionRelationshipService {
  constructor(
    private readonly provider: RelationshipReasoningProvider = createRelationshipReasoningProvider()
  ) {}

  async overview(
    decisionId: string,
    actor: ReviewActor = { authRequired: false }
  ): Promise<DecisionRelationshipOverview> {
    const decision = await prisma.decisionMemory.findUnique({
      where: { id: decisionId },
      select: { id: true }
    });

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    const canManage = canManageRelationships(actor);
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      return {
        enabled: false,
        canManage,
        analysis: null,
        suggestions: [],
        confirmed: []
      };
    }

    const [analysis, relationships] = await Promise.all([
      prisma.decisionRelationshipAnalysis.findUnique({ where: { decisionId } }),
      prisma.decisionRelationship.findMany({
        where: {
          sourceDecision: { status: "APPROVED" },
          targetDecision: { status: "APPROVED" },
          OR: [
            { sourceDecisionId: decisionId, status: { in: ["SUGGESTED", "ACCEPTED"] } },
            { targetDecisionId: decisionId, status: "ACCEPTED" }
          ]
        },
        include: {
          sourceDecision: true,
          targetDecision: true
        },
        orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }]
      })
    ]);

    return {
      enabled: true,
      canManage,
      analysis: analysis ? toAnalysis(analysis) : null,
      suggestions: relationships
        .filter(
          (relationship) =>
            relationship.sourceDecisionId === decisionId && relationship.status === "SUGGESTED"
        )
        .map((relationship) => toRelationship(relationship, decisionId)),
      confirmed: relationships
        .filter((relationship) => relationship.status === "ACCEPTED")
        .map((relationship) => toRelationship(relationship, decisionId))
    };
  }

  async prepareAnalysis(
    decisionId: string,
    actor: ReviewActor = { authRequired: false }
  ): Promise<{ analysis: SharedDecisionRelationshipAnalysis; shouldStart: boolean }> {
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      throw new HttpError(409, "Decision relationship analysis is not enabled");
    }

    ensureCanManageRelationships(actor);
    const decision = await prisma.decisionMemory.findUnique({
      where: { id: decisionId },
      select: { id: true, status: true }
    });

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    if (decision.status !== "APPROVED") {
      throw new HttpError(409, "Only approved decisions can be analyzed for relationships");
    }

    const existing = await prisma.decisionRelationshipAnalysis.findUnique({ where: { decisionId } });
    if (existing && (existing.status === "PENDING" || existing.status === "RUNNING")) {
      return { analysis: toAnalysis(existing), shouldStart: false };
    }

    const analysis = await prisma.decisionRelationshipAnalysis.upsert({
      where: { decisionId },
      create: {
        decisionId,
        status: "PENDING",
        analysisVersion: RELATIONSHIP_ANALYSIS_VERSION,
        requestedByLogin: actorLogin(actor),
        error: null
      },
      update: {
        status: "PENDING",
        analysisVersion: RELATIONSHIP_ANALYSIS_VERSION,
        requestedByLogin: actorLogin(actor),
        error: null
      }
    });

    return { analysis: toAnalysis(analysis), shouldStart: true };
  }

  async markAnalysisFailed(decisionId: string, error: unknown) {
    const analysis = await prisma.decisionRelationshipAnalysis.update({
      where: { decisionId },
      data: {
        status: "FAILED",
        error: errorMessage(error),
        lastAttemptAt: new Date()
      }
    });
    return toAnalysis(analysis);
  }

  async runAnalysis(decisionId: string): Promise<SharedDecisionRelationshipAnalysis> {
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      throw new HttpError(409, "Decision relationship analysis is not enabled");
    }

    await prisma.decisionRelationshipAnalysis.upsert({
      where: { decisionId },
      create: {
        decisionId,
        status: "RUNNING",
        analysisVersion: RELATIONSHIP_ANALYSIS_VERSION,
        lastAttemptAt: new Date()
      },
      update: {
        status: "RUNNING",
        analysisVersion: RELATIONSHIP_ANALYSIS_VERSION,
        lastAttemptAt: new Date(),
        error: null
      }
    });

    try {
      const { source, candidates } = await selectRelationshipCandidates(
        decisionId,
        env.RELATIONSHIP_ANALYSIS_MAX_CANDIDATES
      );
      const assessments = await this.provider.analyze(source, candidates);
      const allowedTargetIds = new Set(candidates.map((candidate) => candidate.id));
      const validAssessments = assessments.filter(
        (assessment) =>
          allowedTargetIds.has(assessment.targetDecisionId) &&
          assessment.confidence >= minimumRelationshipConfidence(assessment.type)
      );

      const analysis = await prisma.$transaction(async (tx) => {
        const currentSuggestions = await tx.decisionRelationship.findMany({
          where: { sourceDecisionId: decisionId, status: "SUGGESTED" }
        });
        const suggestedTargets = new Set(validAssessments.map((assessment) => assessment.targetDecisionId));

        for (const relationship of currentSuggestions) {
          if (suggestedTargets.has(relationship.targetDecisionId)) {
            continue;
          }

          await tx.decisionRelationship.update({
            where: { id: relationship.id },
            data: { status: "STALE" }
          });
          await tx.decisionAuditLog.create({
            data: {
              decisionId,
              action: "RELATIONSHIP_STALE",
              actorLogin: "system",
              note: "A previous relationship suggestion is no longer supported by the latest analysis.",
              after: { relationshipId: relationship.id, targetDecisionId: relationship.targetDecisionId }
            }
          });
        }

        for (const assessment of validAssessments) {
          const existing = await tx.decisionRelationship.findUnique({
            where: {
              sourceDecisionId_targetDecisionId: {
                sourceDecisionId: decisionId,
                targetDecisionId: assessment.targetDecisionId
              }
            }
          });

          if (existing?.status === "ACCEPTED" || existing?.status === "DISMISSED") {
            continue;
          }

          const relationship = existing
            ? await tx.decisionRelationship.update({
                where: { id: existing.id },
                data: {
                  type: assessment.type,
                  status: "SUGGESTED",
                  confidence: assessment.confidence,
                  explanation: assessment.explanation,
                  evidence: assessment.evidence,
                  analysisVersion: RELATIONSHIP_ANALYSIS_VERSION,
                  reviewedByUserId: null,
                  reviewedByLogin: null,
                  reviewedAt: null,
                  reviewNote: null
                }
              })
            : await tx.decisionRelationship.create({
                data: {
                  sourceDecisionId: decisionId,
                  targetDecisionId: assessment.targetDecisionId,
                  type: assessment.type,
                  confidence: assessment.confidence,
                  explanation: assessment.explanation,
                  evidence: assessment.evidence,
                  analysisVersion: RELATIONSHIP_ANALYSIS_VERSION
                }
              });

          if (!existing || existing.status === "STALE") {
            await tx.decisionAuditLog.create({
              data: {
                decisionId,
                action: "RELATIONSHIP_SUGGESTED",
                actorLogin: "system",
                note: `Suggested ${assessment.type.toLowerCase().replaceAll("_", " ")} relationship at ${Math.round(assessment.confidence * 100)}% confidence.`,
                after: {
                  relationshipId: relationship.id,
                  targetDecisionId: assessment.targetDecisionId,
                  type: assessment.type,
                  confidence: assessment.confidence
                }
              }
            });
          }
        }

        const suggestionCount = await tx.decisionRelationship.count({
          where: { sourceDecisionId: decisionId, status: "SUGGESTED" }
        });

        return tx.decisionRelationshipAnalysis.update({
          where: { decisionId },
          data: {
            status: "COMPLETED",
            candidateCount: candidates.length,
            suggestionCount,
            lastSuccessAt: new Date(),
            error: null
          }
        });
      });

      return toAnalysis(analysis);
    } catch (error) {
      await this.markAnalysisFailed(decisionId, error);
      throw error;
    }
  }

  async invalidateForReopenedDecision(decisionId: string) {
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      return [];
    }

    const relationships = await prisma.decisionRelationship.findMany({
      where: {
        status: { in: ["SUGGESTED", "ACCEPTED"] },
        OR: [{ sourceDecisionId: decisionId }, { targetDecisionId: decisionId }]
      },
      select: {
        id: true,
        sourceDecisionId: true,
        targetDecisionId: true,
        status: true
      }
    });

    if (!relationships.length) {
      return [];
    }

    await prisma.$transaction(async (tx) => {
      for (const relationship of relationships) {
        await tx.decisionRelationship.update({
          where: { id: relationship.id },
          data: { status: "STALE" }
        });
        await tx.decisionAuditLog.create({
          data: {
            decisionId: relationship.sourceDecisionId,
            action: "RELATIONSHIP_STALE",
            actorLogin: "system",
            note: "Relationship requires reassessment because a connected decision was reopened.",
            before: { relationshipId: relationship.id, status: relationship.status },
            after: {
              relationshipId: relationship.id,
              status: "STALE",
              reopenedDecisionId: decisionId
            }
          }
        });
      }
    });

    return [
      ...new Set(
        relationships
          .filter((relationship) => relationship.targetDecisionId === decisionId)
          .map((relationship) => relationship.sourceDecisionId)
      )
    ];
  }

  async staleApprovedSourcesForTarget(decisionId: string) {
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      return [];
    }

    const relationships = await prisma.decisionRelationship.findMany({
      where: {
        targetDecisionId: decisionId,
        status: "STALE",
        sourceDecision: { status: "APPROVED" }
      },
      select: { sourceDecisionId: true },
      distinct: ["sourceDecisionId"],
      take: 25
    });

    return relationships.map((relationship) => relationship.sourceDecisionId);
  }

  async accept(
    decisionId: string,
    relationshipId: string,
    note: string | undefined,
    actor: ReviewActor = { authRequired: false }
  ) {
    return this.reviewRelationship(decisionId, relationshipId, "ACCEPTED", note, actor);
  }

  async dismiss(
    decisionId: string,
    relationshipId: string,
    note: string | undefined,
    actor: ReviewActor = { authRequired: false }
  ) {
    return this.reviewRelationship(decisionId, relationshipId, "DISMISSED", note, actor);
  }

  private async reviewRelationship(
    decisionId: string,
    relationshipId: string,
    status: "ACCEPTED" | "DISMISSED",
    note: string | undefined,
    actor: ReviewActor
  ): Promise<SharedDecisionRelationship> {
    if (!env.RELATIONSHIP_ANALYSIS_ENABLED) {
      throw new HttpError(409, "Decision relationship analysis is not enabled");
    }

    ensureCanManageRelationships(actor);
    const existing = await prisma.decisionRelationship.findUnique({
      where: { id: relationshipId },
      include: { sourceDecision: true, targetDecision: true }
    });

    if (!existing || existing.sourceDecisionId !== decisionId) {
      throw new HttpError(404, "Relationship suggestion not found");
    }

    if (existing.sourceDecision.status !== "APPROVED" || existing.targetDecision.status !== "APPROVED") {
      throw new HttpError(409, "Both decisions must be approved before a relationship can be confirmed");
    }

    if (existing.status === status) {
      return toRelationship(existing, decisionId);
    }

    if (existing.status !== "SUGGESTED") {
      throw new HttpError(409, "Only active relationship suggestions can be reviewed");
    }

    const relationship = await prisma.$transaction(async (tx) => {
      const reviewed = await tx.decisionRelationship.update({
        where: { id: relationshipId },
        data: {
          status,
          reviewedByUserId: actor.user?.id ?? null,
          reviewedByLogin: actorLogin(actor),
          reviewedAt: new Date(),
          reviewNote: note
        },
        include: { sourceDecision: true, targetDecision: true }
      });

      await tx.decisionAuditLog.create({
        data: {
          decisionId,
          action: status === "ACCEPTED" ? "RELATIONSHIP_ACCEPTED" : "RELATIONSHIP_DISMISSED",
          actorUserId: actor.user?.id,
          actorLogin: actorLogin(actor),
          note,
          before: { relationshipId, status: existing.status },
          after: {
            relationshipId,
            status,
            targetDecisionId: existing.targetDecisionId,
            type: existing.type
          }
        }
      });

      return reviewed;
    });

    return toRelationship(relationship, decisionId);
  }
}

export const decisionRelationshipService = new DecisionRelationshipService();
