import { Prisma } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../middleware/error.js";
import { GitHubApiError } from "../github/client.js";
import { prisma } from "../database/prisma.js";
import { githubContextService } from "./github-context.service.js";
import { fetchGitHubIssue } from "./providers/github.provider.js";
import { resolveExternalContextUrl } from "./providers/index.js";

function errorMessage(error: unknown) {
  if (error instanceof GitHubApiError) {
    return `GitHub API returned HTTP ${error.status}: ${error.message}`;
  }

  return error instanceof Error ? error.message : "Context synchronization failed";
}

export class ContextSyncService {
  async prepare(contextId: string) {
    await prisma.contextSync.upsert({
      where: { contextId },
      update: {
        status: "PENDING",
        error: null
      },
      create: {
        contextId,
        status: "PENDING"
      }
    });
  }

  async sync(contextId: string) {
    const context = await prisma.externalContext.findUnique({ where: { id: contextId } });
    if (!context) {
      throw new HttpError(404, "External context not found");
    }

    if (context.provider !== "GITHUB" || context.type !== "ISSUE") {
      throw new HttpError(400, "Only GitHub issue contexts can be synchronized in Phase 2");
    }

    const lastAttemptAt = new Date();
    await prisma.contextSync.upsert({
      where: { contextId },
      update: {
        status: "SYNCING",
        lastAttemptAt,
        error: null
      },
      create: {
        contextId,
        status: "SYNCING",
        lastAttemptAt
      }
    });

    try {
      const installationId = await githubContextService.activeInstallationId();
      const resolved = resolveExternalContextUrl(context.normalizedUrl, { type: "ISSUE" });
      const snapshot = await fetchGitHubIssue(resolved, installationId);
      const completedAt = new Date();

      await prisma.$transaction([
        prisma.externalContext.update({
          where: { id: contextId },
          data: {
            title: snapshot.title,
            description: snapshot.description,
            url: snapshot.url,
            normalizedUrl: snapshot.normalizedUrl,
            metadata: snapshot.metadata as unknown as Prisma.InputJsonObject,
            status: "ACTIVE",
            lastSyncedAt: completedAt
          }
        }),
        prisma.contextSync.update({
          where: { contextId },
          data: {
            status: "SYNCED",
            lastSuccessAt: completedAt,
            error: null
          }
        })
      ]);

      logger.info({ contextId }, "GitHub issue context synchronized");
      return { status: "SYNCED" as const };
    } catch (error) {
      const message = errorMessage(error);

      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 410)) {
        await prisma.$transaction([
          prisma.externalContext.update({
            where: { id: contextId },
            data: { status: "UNAVAILABLE" }
          }),
          prisma.contextSync.update({
            where: { contextId },
            data: {
              status: "UNAVAILABLE",
              error: message
            }
          })
        ]);
        return { status: "UNAVAILABLE" as const };
      }

      await prisma.contextSync.update({
        where: { contextId },
        data: {
          status: "FAILED",
          error: message
        }
      });

      if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500) {
        return { status: "FAILED" as const };
      }

      throw error;
    }
  }
}

export const contextSyncService = new ContextSyncService();
