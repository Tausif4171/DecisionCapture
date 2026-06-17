import type {
  AnalyzeResponse,
  DecisionListResponse,
  DecisionMemory,
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
import { resolveDecisionStatus, scoreDecisionContext } from "./scoring.js";
import type { DecisionReviewUpdates, DecisionSearchOptions } from "./types.js";

function toDecisionMemory(decision: DecisionMemoryRecord): DecisionMemory {
  return {
    ...decision,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString()
  };
}

function mergedAtDate(context: PRContext) {
  return context.mergedAt ? new Date(context.mergedAt) : undefined;
}

function isMissingDecisionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
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
    const status = resolveDecisionStatus(extracted.confidence, env.AUTO_APPROVE_CONFIDENCE) as DecisionStatus;

    const existingDecision = await prisma.decisionMemory.findFirst({
      where: { prRecordId: prRecord.id },
      orderBy: { createdAt: "asc" }
    });

    const decisionPayload = {
      decision: extracted.decision,
      reason: extracted.reason,
      alternative: extracted.alternative,
      impact: extracted.impact,
      author: extracted.author,
      sourcePR: extracted.source,
      repository: context.repository,
      filesChanged: context.filesChanged,
      confidence: extracted.confidence,
      status,
      category: extracted.category
    };

    const decision = existingDecision
      ? await prisma.decisionMemory.update({
          where: { id: existingDecision.id },
          data: decisionPayload
        })
      : await prisma.decisionMemory.create({
          data: {
            ...decisionPayload,
            prRecordId: prRecord.id
          }
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
        take: options.limit ?? 30
      }),
      prisma.decisionMemory.count({ where })
    ]);

    return {
      decisions: decisions.map(toDecisionMemory),
      total
    };
  }

  async getDecision(id: string): Promise<DecisionMemory | null> {
    const decision = await prisma.decisionMemory.findUnique({ where: { id } });
    return decision ? toDecisionMemory(decision) : null;
  }

  async updateDecision(id: string, updates: DecisionReviewUpdates): Promise<DecisionMemory> {
    try {
      const decision = await prisma.decisionMemory.update({
        where: { id },
        data: updates
      });

      return toDecisionMemory(decision);
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async approveDecision(id: string, updates: DecisionReviewUpdates): Promise<DecisionMemory> {
    try {
      const decision = await prisma.decisionMemory.update({
        where: { id },
        data: {
          ...updates,
          status: "APPROVED"
        }
      });

      return toDecisionMemory(decision);
    } catch (error) {
      if (isMissingDecisionError(error)) {
        throw new HttpError(404, "Decision not found");
      }

      throw error;
    }
  }

  async rejectDecision(id: string): Promise<DecisionMemory> {
    try {
      const decision = await prisma.decisionMemory.update({
        where: { id },
        data: {
          status: "REJECTED"
        }
      });

      return toDecisionMemory(decision);
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
          take: 5
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
