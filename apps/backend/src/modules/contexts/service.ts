import type {
  ContextSyncStatus,
  ContextUrlResolution,
  DecisionContextLink as DecisionContextLinkResponse,
  DecisionContextRelationshipType,
  ExternalContext as ExternalContextResponse,
  ExternalContextType
} from "@decisioncapture/shared";
import { Prisma } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../middleware/error.js";
import { prisma } from "../database/prisma.js";
import { privilegedRoles, type ReviewActor } from "../auth/types.js";
import { prContextSchema } from "../decisions/validation.js";
import { resolveExternalContextUrl } from "./providers/index.js";
import { enqueueContextSync } from "./queue.js";

type DecisionForContextAccess = {
  id: string;
  author: string;
  prRecord?: {
    sourcePayload: Prisma.JsonValue | null;
  } | null;
};

type ExternalContextRecord = {
  id: string;
  provider: ExternalContextResponse["provider"];
  type: ExternalContextResponse["type"];
  providerAccountId: string;
  externalId: string;
  url: string;
  normalizedUrl: string;
  title: string | null;
  description: string | null;
  status: ExternalContextResponse["status"];
  metadata: Prisma.JsonValue | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  syncState?: {
    status: ContextSyncStatus;
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    error: string | null;
  } | null;
};

type DecisionContextLinkRecord = {
  id: string;
  decisionId: string;
  externalContextId: string;
  relationshipType: DecisionContextRelationshipType;
  createdByLogin: string | null;
  createdAt: Date;
  updatedAt: Date;
  externalContext: ExternalContextRecord;
};

export type CreateDecisionContextLinkInput = {
  url?: string;
  externalContextId?: string;
  relationshipType?: DecisionContextRelationshipType;
  title?: string;
  description?: string;
  type?: ExternalContextType;
};

type CreateDecisionContextLinkOptions = {
  createdByLogin?: string;
};

function normalizeLogin(login: string | null | undefined) {
  return login?.trim().toLowerCase() ?? "";
}

function actorLogin(actor: ReviewActor) {
  return actor.user?.login ?? null;
}

function metadataToObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toExternalContext(context: ExternalContextRecord): ExternalContextResponse {
  return {
    id: context.id,
    provider: context.provider,
    type: context.type,
    providerAccountId: context.providerAccountId,
    externalId: context.externalId,
    url: context.url,
    normalizedUrl: context.normalizedUrl,
    title: context.title,
    description: context.description,
    status: context.status,
    metadata: metadataToObject(context.metadata),
    lastSyncedAt: context.lastSyncedAt?.toISOString() ?? null,
    sync: context.syncState
      ? {
          status: context.syncState.status,
          lastAttemptAt: context.syncState.lastAttemptAt?.toISOString() ?? null,
          lastSuccessAt: context.syncState.lastSuccessAt?.toISOString() ?? null,
          error: context.syncState.error
        }
      : null,
    createdAt: context.createdAt.toISOString(),
    updatedAt: context.updatedAt.toISOString()
  };
}

function toDecisionContextLink(link: DecisionContextLinkRecord): DecisionContextLinkResponse {
  return {
    id: link.id,
    decisionId: link.decisionId,
    externalContextId: link.externalContextId,
    relationshipType: link.relationshipType,
    createdByLogin: link.createdByLogin,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    context: toExternalContext(link.externalContext)
  };
}

function contextFromDecision(decision: DecisionForContextAccess) {
  const parsed = prContextSchema.safeParse(decision.prRecord?.sourcePayload);
  return parsed.success ? parsed.data : null;
}

function canManageDecisionContext(decision: DecisionForContextAccess, actor: ReviewActor) {
  if (!actor.authRequired) {
    return true;
  }

  if (!actor.user) {
    return false;
  }

  if (privilegedRoles.includes(actor.user.role)) {
    return true;
  }

  const context = contextFromDecision(decision);
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

  return allowedLogins.has(normalizeLogin(actor.user.login));
}

function isMissingRecordError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function isDuplicateRecordError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function providerMetadata(metadata: Record<string, unknown> | null | undefined) {
  return metadata ? (metadata as Prisma.InputJsonObject) : Prisma.JsonNull;
}

export class ContextService {
  resolveUrl(input: { url: string; type?: ExternalContextType }): ContextUrlResolution {
    return resolveExternalContextUrl(input.url, { type: input.type });
  }

  async listDecisionContexts(decisionId: string): Promise<DecisionContextLinkResponse[]> {
    await this.requireExistingDecision(decisionId);

    const links = await prisma.decisionContextLink.findMany({
      where: { decisionId },
      include: {
        externalContext: {
          include: { syncState: true }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return links.map(toDecisionContextLink);
  }

  async getContext(id: string): Promise<ExternalContextResponse> {
    const context = await prisma.externalContext.findUnique({
      where: { id },
      include: { syncState: true }
    });

    if (!context) {
      throw new HttpError(404, "External context not found");
    }

    return toExternalContext(context);
  }

  async createDecisionContextLink(
    decisionId: string,
    input: CreateDecisionContextLinkInput,
    actor: ReviewActor = { authRequired: false },
    options: CreateDecisionContextLinkOptions = {}
  ): Promise<DecisionContextLinkResponse> {
    await this.requireDecisionContextMutationAccess(decisionId, actor);

    try {
      const link = await prisma.$transaction(async (tx) => {
        const externalContext = input.externalContextId
          ? await tx.externalContext.findUnique({
              where: { id: input.externalContextId }
            })
          : await this.upsertResolvedContext(
              tx,
              resolveExternalContextUrl(input.url ?? "", { type: input.type }),
              input
            );

        if (!externalContext) {
          throw new HttpError(400, "External context not found");
        }

        const existingLink = await tx.decisionContextLink.findUnique({
          where: {
            decisionId_externalContextId: {
              decisionId,
              externalContextId: externalContext.id
            }
          }
        });

        if (existingLink) {
          throw new HttpError(409, "External context is already linked to this decision");
        }

        return tx.decisionContextLink.create({
          data: {
            decisionId,
            externalContextId: externalContext.id,
            relationshipType: input.relationshipType ?? "RELATED",
            createdByUserId: actor.user?.id,
            createdByLogin: options.createdByLogin ?? actorLogin(actor)
          },
          include: {
            externalContext: {
              include: { syncState: true }
            }
          }
        });
      });

      if (link.externalContext.provider === "GITHUB" && link.externalContext.type === "ISSUE") {
        try {
          await enqueueContextSync(link.externalContext.id);
        } catch (error) {
          logger.warn(
            { error, contextId: link.externalContext.id, decisionId },
            "GitHub context was linked but initial synchronization could not be scheduled"
          );
        }
      }

      return toDecisionContextLink(link);
    } catch (error) {
      if (isDuplicateRecordError(error)) {
        throw new HttpError(409, "External context is already linked to this decision");
      }

      throw error;
    }
  }

  async deleteDecisionContextLink(
    decisionId: string,
    externalContextId: string,
    actor: ReviewActor = { authRequired: false }
  ) {
    await this.requireDecisionContextMutationAccess(decisionId, actor);

    try {
      await prisma.decisionContextLink.delete({
        where: {
          decisionId_externalContextId: {
            decisionId,
            externalContextId
          }
        }
      });
    } catch (error) {
      if (isMissingRecordError(error)) {
        throw new HttpError(404, "Decision context link not found");
      }

      throw error;
    }
  }

  async refreshDecisionContext(
    decisionId: string,
    externalContextId: string,
    actor: ReviewActor = { authRequired: false }
  ) {
    await this.requireDecisionContextMutationAccess(decisionId, actor);
    const link = await prisma.decisionContextLink.findUnique({
      where: {
        decisionId_externalContextId: {
          decisionId,
          externalContextId
        }
      },
      include: { externalContext: true }
    });

    if (!link) {
      throw new HttpError(404, "Decision context link not found");
    }

    if (link.externalContext.provider !== "GITHUB" || link.externalContext.type !== "ISSUE") {
      throw new HttpError(400, "Only GitHub issue contexts can be refreshed in Phase 2");
    }

    await enqueueContextSync(externalContextId);
    return { status: "queued" as const };
  }

  private async requireExistingDecision(decisionId: string) {
    const decision = await prisma.decisionMemory.findUnique({
      where: { id: decisionId },
      select: { id: true }
    });

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }
  }

  private async requireDecisionContextMutationAccess(decisionId: string, actor: ReviewActor) {
    const decision = await prisma.decisionMemory.findUnique({
      where: { id: decisionId },
      include: { prRecord: true }
    });

    if (!decision) {
      throw new HttpError(404, "Decision not found");
    }

    if (!actor.authRequired) {
      return;
    }

    if (!actor.user) {
      throw new HttpError(401, "GitHub sign-in is required to manage decision context");
    }

    if (!canManageDecisionContext(decision, actor)) {
      throw new HttpError(
        403,
        "Only PR participants or a DecisionCapture reviewer can manage context links for this decision"
      );
    }
  }

  private async upsertResolvedContext(
    tx: Prisma.TransactionClient,
    resolved: ContextUrlResolution,
    input: CreateDecisionContextLinkInput
  ) {
    return tx.externalContext.upsert({
      where: {
        provider_providerAccountId_externalId: {
          provider: resolved.provider,
          providerAccountId: resolved.providerAccountId,
          externalId: resolved.externalId
        }
      },
      update: {
        url: resolved.url,
        normalizedUrl: resolved.normalizedUrl,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      },
      create: {
        provider: resolved.provider,
        type: resolved.type,
        providerAccountId: resolved.providerAccountId,
        externalId: resolved.externalId,
        url: resolved.url,
        normalizedUrl: resolved.normalizedUrl,
        title: input.title ?? resolved.title ?? null,
        description: input.description ?? null,
        metadata: providerMetadata(resolved.metadata),
        status: "ACTIVE"
      }
    });
  }
}

export const contextService = new ContextService();
