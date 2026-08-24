import type {
  GitHubConnectionStatus,
  GitHubIssueSummary,
  GitHubRepositorySummary
} from "@decisioncapture/shared";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { hasGitHubAppCredentials } from "../github/auth.js";
import { prisma } from "../database/prisma.js";
import type { ReviewActor } from "../auth/types.js";
import {
  getGitHubInstallation,
  listGitHubIssues,
  listGitHubRepositories
} from "./providers/github.provider.js";

function configuredInstallationId() {
  return env.GITHUB_APP_INSTALLATION_ID ?? null;
}

function providerAccountId(installationId: string) {
  return `installation:${installationId}`;
}

function metadataObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class GitHubContextService {
  async connectionStatus(): Promise<GitHubConnectionStatus> {
    const installationId = configuredInstallationId();
    if (!hasGitHubAppCredentials() || !installationId) {
      return {
        configured: false,
        connected: false,
        installationId: null,
        accountLogin: null,
        repositorySelection: null,
        status: null
      };
    }

    const connection = await prisma.providerConnection.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "GITHUB",
          providerAccountId: providerAccountId(installationId)
        }
      }
    });
    const metadata = metadataObject(connection?.metadata);
    const canReadIssues =
      connection?.scopes.includes("issues:read") || connection?.scopes.includes("issues:write");

    return {
      configured: true,
      connected: connection?.status === "ACTIVE" && Boolean(canReadIssues),
      installationId,
      accountLogin: typeof metadata.accountLogin === "string" ? metadata.accountLogin : null,
      repositorySelection:
        typeof metadata.repositorySelection === "string" ? metadata.repositorySelection : null,
      status: connection?.status ?? null
    };
  }

  async connect(actor: ReviewActor): Promise<GitHubConnectionStatus> {
    const installationId = configuredInstallationId();
    if (!hasGitHubAppCredentials() || !installationId) {
      throw new HttpError(503, "GitHub App credentials are not configured");
    }

    const installation = await getGitHubInstallation(installationId);
    const issuesPermission = installation.permissions?.issues;
    if (issuesPermission !== "read" && issuesPermission !== "write") {
      throw new HttpError(409, "GitHub App requires repository Issues read permission");
    }

    const accountLogin = installation.account.login ?? installation.account.slug ?? String(installation.account.id);

    await prisma.providerConnection.upsert({
      where: {
        provider_providerAccountId: {
          provider: "GITHUB",
          providerAccountId: providerAccountId(installationId)
        }
      },
      update: {
        status: "ACTIVE",
        scopes: Object.entries(installation.permissions ?? {}).map(
          ([permission, access]) => `${permission}:${access}`
        ),
        metadata: {
          installationId,
          accountId: installation.account.id,
          accountLogin,
          accountType: installation.account.type ?? null,
          repositorySelection: installation.repository_selection
        }
      },
      create: {
        provider: "GITHUB",
        providerAccountId: providerAccountId(installationId),
        status: "ACTIVE",
        scopes: Object.entries(installation.permissions ?? {}).map(
          ([permission, access]) => `${permission}:${access}`
        ),
        metadata: {
          installationId,
          accountId: installation.account.id,
          accountLogin,
          accountType: installation.account.type ?? null,
          repositorySelection: installation.repository_selection
        },
        createdByUserId: actor.user?.id
      }
    });

    return this.connectionStatus();
  }

  async activeInstallationId() {
    const status = await this.connectionStatus();
    if (!status.connected || !status.installationId) {
      throw new HttpError(409, "Connect the configured GitHub App before synchronizing issues");
    }

    return status.installationId;
  }

  async repositories(): Promise<GitHubRepositorySummary[]> {
    return listGitHubRepositories(await this.activeInstallationId());
  }

  async issues(repository: string, query: string): Promise<GitHubIssueSummary[]> {
    return listGitHubIssues(repository, query, await this.activeInstallationId());
  }
}

export const githubContextService = new GitHubContextService();
