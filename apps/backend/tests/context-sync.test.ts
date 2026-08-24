import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  externalContext: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  contextSync: {
    upsert: vi.fn(),
    update: vi.fn()
  }
}));
const connectionMock = vi.hoisted(() => ({
  githubContextService: {
    activeInstallationId: vi.fn()
  }
}));
const providerMock = vi.hoisted(() => ({
  fetchGitHubIssue: vi.fn()
}));

vi.mock("../src/modules/database/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/modules/contexts/github-context.service.js", () => connectionMock);
vi.mock("../src/modules/contexts/providers/github.provider.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, fetchGitHubIssue: providerMock.fetchGitHubIssue };
});

import { GitHubApiError } from "../src/modules/github/client.js";
import { HttpError } from "../src/middleware/error.js";
import { ContextSyncService } from "../src/modules/contexts/sync.service.js";

function context() {
  return {
    id: "context-91",
    provider: "GITHUB",
    type: "ISSUE",
    normalizedUrl: "https://github.com/acme/api/issues/91"
  };
}

describe("ContextSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (operations) => Promise.all(operations));
    prismaMock.externalContext.findUnique.mockResolvedValue(context());
    prismaMock.externalContext.update.mockResolvedValue(context());
    prismaMock.contextSync.upsert.mockResolvedValue({ contextId: "context-91" });
    prismaMock.contextSync.update.mockResolvedValue({ contextId: "context-91" });
    connectionMock.githubContextService.activeInstallationId.mockResolvedValue("installation-1");
  });

  it("stores normalized GitHub metadata and marks synchronization successful", async () => {
    providerMock.fetchGitHubIssue.mockResolvedValue({
      title: "Centralize token refresh",
      description: "Keep refresh behavior consistent.",
      url: "https://github.com/acme/api/issues/91",
      normalizedUrl: "https://github.com/acme/api/issues/91",
      metadata: {
        owner: "acme",
        repo: "api",
        repository: "acme/api",
        issueNumber: 91,
        githubIssueId: 91
      }
    });

    const result = await new ContextSyncService().sync("context-91");

    expect(result).toEqual({ status: "SYNCED" });
    expect(prismaMock.externalContext.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "context-91" },
        data: expect.objectContaining({
          title: "Centralize token refresh",
          status: "ACTIVE",
          lastSyncedAt: expect.any(Date)
        })
      })
    );
    expect(prismaMock.contextSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SYNCED" })
      })
    );
  });

  it("preserves the context and marks it unavailable after GitHub returns gone", async () => {
    providerMock.fetchGitHubIssue.mockRejectedValue(
      new GitHubApiError("Issue is gone", 410, null, null, null)
    );

    await expect(new ContextSyncService().sync("context-91")).resolves.toEqual({
      status: "UNAVAILABLE"
    });
    expect(prismaMock.externalContext.update).toHaveBeenCalledWith({
      where: { id: "context-91" },
      data: { status: "UNAVAILABLE" }
    });
    expect(prismaMock.contextSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNAVAILABLE" })
      })
    );
  });

  it("records a non-retryable failure when GitHub is not connected", async () => {
    connectionMock.githubContextService.activeInstallationId.mockRejectedValue(
      new HttpError(409, "Connect GitHub")
    );

    await expect(new ContextSyncService().sync("context-91")).resolves.toEqual({
      status: "FAILED"
    });
    expect(prismaMock.contextSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" })
      })
    );
  });
});
