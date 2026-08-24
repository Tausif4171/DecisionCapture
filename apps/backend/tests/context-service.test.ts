import type { PRContext } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  decisionMemory: {
    findUnique: vi.fn()
  },
  externalContext: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  },
  decisionContextLink: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn()
  }
}));

const queueMock = vi.hoisted(() => ({
  enqueueContextSync: vi.fn()
}));

vi.mock("../src/modules/database/prisma.js", () => ({
  prisma: mockPrisma
}));
vi.mock("../src/modules/contexts/queue.js", () => queueMock);

import { ContextService } from "../src/modules/contexts/service.js";
import { createDecisionContextLinkSchema } from "../src/modules/contexts/validation.js";
import { normalizeExternalUrl } from "../src/modules/contexts/providers/index.js";

function buildPrContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 42,
    title: "Move auth refresh into a central service",
    description: "Decision: Centralize refresh logic",
    mergedAt: "2026-06-16T06:30:00.000Z",
    author: "maya.dev",
    url: "https://github.com/acme/platform/pull/42",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/modules/auth/service.ts"],
    commits: ["refactor: centralize auth refresh"],
    reviewers: ["lee.dev"],
    reviewComments: ["This keeps refresh behavior consistent."],
    approvals: ["lee.dev"],
    labels: ["architecture"],
    diffSummary: "diff --git a/apps/backend/src/modules/auth/service.ts b/apps/backend/src/modules/auth/service.ts",
    ...overrides
  };
}

function buildDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-42",
    decision: "Move auth refresh into a central service",
    author: "maya.dev",
    prRecord: {
      sourcePayload: buildPrContext()
    },
    ...overrides
  };
}

function buildExternalContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "context-1",
    provider: "GITHUB",
    type: "ISSUE",
    providerAccountId: "acme/platform",
    externalId: "issue:91",
    url: "https://github.com/acme/platform/issues/91",
    normalizedUrl: "https://github.com/acme/platform/issues/91",
    title: "acme/platform#91",
    description: null,
    status: "ACTIVE",
    metadata: {
      owner: "acme",
      repo: "platform",
      issueNumber: 91
    },
    lastSyncedAt: null,
    createdAt: new Date("2026-06-16T06:30:00.000Z"),
    updatedAt: new Date("2026-06-16T06:30:00.000Z"),
    ...overrides
  };
}

function buildContextLink(overrides: Record<string, unknown> = {}) {
  const externalContext = buildExternalContext();

  return {
    id: "link-1",
    decisionId: "decision-42",
    externalContextId: externalContext.id,
    relationshipType: "RELATED",
    createdByLogin: null,
    createdAt: new Date("2026-06-16T06:35:00.000Z"),
    updatedAt: new Date("2026-06-16T06:35:00.000Z"),
    externalContext,
    ...overrides
  };
}

describe("ContextService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    queueMock.enqueueContextSync.mockResolvedValue(undefined);
  });

  it("normalizes external URLs into stable identities", () => {
    expect(normalizeExternalUrl("https://github.com/acme/platform/issues/91/")).toBe(
      "https://github.com/acme/platform/issues/91"
    );
    expect(normalizeExternalUrl("HTTPS://Example.com/docs/?b=2&a=1#section")).toBe(
      "https://example.com/docs?a=1&b=2"
    );

    const service = new ContextService();

    expect(service.resolveUrl({ url: "https://github.com/acme/platform/issues/91/" })).toMatchObject({
      provider: "GITHUB",
      type: "ISSUE",
      providerAccountId: "acme/platform",
      externalId: "issue:91",
      normalizedUrl: "https://github.com/acme/platform/issues/91"
    });
  });

  it("rejects provider/type mismatches and invalid enum values", () => {
    const service = new ContextService();

    expect(() =>
      service.resolveUrl({
        url: "https://github.com/acme/platform/issues/91",
        type: "ADR"
      })
    ).toThrowError("External URL resolves to ISSUE, not ADR");
    expect(() =>
      createDecisionContextLinkSchema.parse({
        url: "https://github.com/acme/platform/issues/91",
        type: "WHITEBOARD"
      })
    ).toThrow();
  });

  it("creates a context link from a URL", async () => {
    const service = new ContextService();
    const externalContext = buildExternalContext();
    const link = buildContextLink({ externalContext });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(buildDecision());
    mockPrisma.externalContext.upsert.mockResolvedValue(externalContext);
    mockPrisma.decisionContextLink.findUnique.mockResolvedValue(null);
    mockPrisma.decisionContextLink.create.mockResolvedValue(link);

    const result = await service.createDecisionContextLink("decision-42", {
      url: "https://github.com/acme/platform/issues/91/",
      relationshipType: "ORIGINATED_FROM"
    });

    expect(mockPrisma.externalContext.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerAccountId_externalId: {
            provider: "GITHUB",
            providerAccountId: "acme/platform",
            externalId: "issue:91"
          }
        }
      })
    );
    expect(mockPrisma.decisionContextLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionId: "decision-42",
          externalContextId: "context-1",
          relationshipType: "ORIGINATED_FROM"
        })
      })
    );
    expect(result).toMatchObject({
      decisionId: "decision-42",
      context: {
        provider: "GITHUB",
        type: "ISSUE"
      }
    });
    expect(queueMock.enqueueContextSync).toHaveBeenCalledWith("context-1");
  });

  it("retrieves context links for a decision", async () => {
    const service = new ContextService();
    const link = buildContextLink();

    mockPrisma.decisionMemory.findUnique.mockResolvedValue({ id: "decision-42" });
    mockPrisma.decisionContextLink.findMany.mockResolvedValue([link]);

    const result = await service.listDecisionContexts("decision-42");

    expect(mockPrisma.decisionContextLink.findMany).toHaveBeenCalledWith({
      where: { decisionId: "decision-42" },
      include: {
        externalContext: {
          include: { syncState: true }
        }
      },
      orderBy: { createdAt: "asc" }
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.context.normalizedUrl).toBe("https://github.com/acme/platform/issues/91");
  });

  it("deletes a context link without deleting the external context", async () => {
    const service = new ContextService();

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(buildDecision());
    mockPrisma.decisionContextLink.delete.mockResolvedValue(buildContextLink());

    await service.deleteDecisionContextLink("decision-42", "context-1");

    expect(mockPrisma.decisionContextLink.delete).toHaveBeenCalledWith({
      where: {
        decisionId_externalContextId: {
          decisionId: "decision-42",
          externalContextId: "context-1"
        }
      }
    });
  });

  it("rejects duplicate context links", async () => {
    const service = new ContextService();

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(buildDecision());
    mockPrisma.externalContext.upsert.mockResolvedValue(buildExternalContext());
    mockPrisma.decisionContextLink.findUnique.mockResolvedValue({ id: "existing-link" });

    await expect(
      service.createDecisionContextLink("decision-42", {
        url: "https://github.com/acme/platform/issues/91"
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockPrisma.decisionContextLink.create).not.toHaveBeenCalled();
  });

  it("denies an unrelated viewer when auth is required", async () => {
    const service = new ContextService();

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(buildDecision());

    await expect(
      service.createDecisionContextLink(
        "decision-42",
        {
          url: "https://github.com/acme/platform/issues/91"
        },
        {
          authRequired: true,
          user: {
            id: "user-outsider",
            githubId: "202",
            login: "outsider",
            name: null,
            avatarUrl: null,
            role: "VIEWER"
          }
        }
      )
    ).rejects.toMatchObject({
      statusCode: 403
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a link to a missing external context", async () => {
    const service = new ContextService();

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(buildDecision());
    mockPrisma.externalContext.findUnique.mockResolvedValue(null);

    await expect(
      service.createDecisionContextLink("decision-42", {
        externalContextId: "missing-context"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "External context not found"
    });
    expect(mockPrisma.decisionContextLink.create).not.toHaveBeenCalled();
  });

  it("preserves unavailable external context metadata on linked decisions", async () => {
    const service = new ContextService();
    const unavailableLink = buildContextLink({
      externalContext: buildExternalContext({
        status: "UNAVAILABLE",
        title: "ENG-91",
        metadata: {
          lastKnownStatus: "deleted"
        }
      })
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue({ id: "decision-42" });
    mockPrisma.decisionContextLink.findMany.mockResolvedValue([unavailableLink]);

    const result = await service.listDecisionContexts("decision-42");

    expect(result[0]).toMatchObject({
      context: {
        status: "UNAVAILABLE",
        title: "ENG-91",
        metadata: {
          lastKnownStatus: "deleted"
        }
      }
    });
  });

  it("returns synchronization state with linked context", async () => {
    const service = new ContextService();
    const link = buildContextLink({
      externalContext: buildExternalContext({
        syncState: {
          status: "SYNCED",
          lastAttemptAt: new Date("2026-06-16T06:36:00.000Z"),
          lastSuccessAt: new Date("2026-06-16T06:36:01.000Z"),
          error: null
        }
      })
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue({ id: "decision-42" });
    mockPrisma.decisionContextLink.findMany.mockResolvedValue([link]);

    const result = await service.listDecisionContexts("decision-42");

    expect(result[0]?.context.sync).toEqual({
      status: "SYNCED",
      lastAttemptAt: "2026-06-16T06:36:00.000Z",
      lastSuccessAt: "2026-06-16T06:36:01.000Z",
      error: null
    });
  });
});
