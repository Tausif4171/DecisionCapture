import type { ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  pullRequestRecord: {
    upsert: vi.fn()
  },
  decisionMemory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  },
  decisionAuditLog: {
    create: vi.fn(),
    findMany: vi.fn()
  }
}));

vi.mock("../src/modules/database/prisma.js", () => ({
  prisma: mockPrisma
}));

import { MISSING_REASON } from "../src/modules/decisions/evidence.js";
import { DecisionService } from "../src/modules/decisions/service.js";

function buildContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 123,
    title: "Use a Redis-backed queue for asynchronous PR analysis",
    description: `Decision: Use BullMQ with Redis for merged PR analysis
Reason: Webhook processing should stay fast and retries should happen outside the request path.
Alternative: Analyze every PR inline inside the webhook request.
Impact: Failures can retry without blocking GitHub delivery.`,
    mergedAt: "2026-06-16T06:30:00.000Z",
    author: "maya.dev",
    url: "https://github.com/acme/platform/pull/123",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/modules/queue/queue.ts", "docker-compose.yml"],
    commits: ["feat: move analysis into BullMQ worker"],
    reviewers: ["lee.dev"],
    reviewComments: ["This keeps webhook latency low"],
    approvals: ["lee.dev"],
    labels: ["infrastructure"],
    diffSummary: "diff --git a/apps/backend/src/modules/queue/queue.ts b/apps/backend/src/modules/queue/queue.ts",
    ...overrides
  };
}

function buildExtractedDecision(overrides: Partial<ExtractedDecision> = {}): ExtractedDecision {
  return {
    decision: "Use a Redis-backed queue for asynchronous PR analysis",
    reason: "Merged PR context can be expensive to score and summarize, so the work should run outside the request path with retries and failure isolation.",
    alternative: "Analyze every merged PR synchronously inside the webhook request",
    impact: "Webhook handling stays fast while failed analyses can be retried without losing the PR context.",
    author: "maya.dev",
    source: "PR #123",
    confidence: 0.75,
    category: "infrastructure",
    extractionMethod: "OLLAMA",
    ...overrides
  };
}

function buildDecisionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-1",
    decision: "Use a Redis-backed queue for asynchronous PR analysis",
    reason: "Reason",
    alternative: "Alternative",
    impact: "Impact",
    author: "maya.dev",
    sourcePR: "PR #123",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/modules/queue/queue.ts"],
    confidence: 0.75,
    status: "PENDING",
    category: "infrastructure",
    extractionMethod: "OLLAMA",
    prRecordId: "pr-record-1",
    approvedByUserId: null,
    approvedByLogin: null,
    approvedAt: null,
    rejectedByUserId: null,
    rejectedByLogin: null,
    rejectedAt: null,
    lastEditedByUserId: null,
    lastEditedByLogin: null,
    createdAt: new Date("2026-06-16T06:30:00.000Z"),
    updatedAt: new Date("2026-06-16T06:30:00.000Z"),
    ...overrides
  };
}

function buildReviewableDecisionRecord(overrides: Record<string, unknown> = {}) {
  return buildDecisionRecord({
    prRecord: {
      sourcePayload: buildContext()
    },
    ...overrides
  });
}

describe("DecisionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.decisionAuditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("creates a pending decision when no prior record exists", async () => {
    const aiProvider = {
      extractDecision: vi.fn().mockResolvedValue(buildExtractedDecision())
    };
    const service = new DecisionService(aiProvider);

    mockPrisma.pullRequestRecord.upsert.mockResolvedValue({
      id: "pr-record-1"
    });
    mockPrisma.decisionMemory.findFirst.mockResolvedValue(null);
    mockPrisma.decisionMemory.create.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-1",
        prRecordId: "pr-record-1"
      })
    );

    const result = await service.analyzePrContext(buildContext());

    expect(aiProvider.extractDecision).toHaveBeenCalled();
    expect(mockPrisma.pullRequestRecord.upsert).toHaveBeenCalled();
    expect(mockPrisma.decisionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prRecordId: "pr-record-1",
          status: "PENDING",
          repository: "acme/platform"
        })
      })
    );
    expect(result).toMatchObject({
      status: "processed",
      decision: {
        id: "decision-1",
        status: "PENDING"
      }
    });
  });

  it("updates the existing decision for the same PR instead of creating a duplicate", async () => {
    const aiProvider = {
      extractDecision: vi.fn().mockResolvedValue(
        buildExtractedDecision({
          confidence: 0.91,
          impact: "The queue worker owns retries and isolation for merged PR analysis."
        })
      )
    };
    const service = new DecisionService(aiProvider);

    mockPrisma.pullRequestRecord.upsert.mockResolvedValue({
      id: "pr-record-1"
    });
    mockPrisma.decisionMemory.findFirst.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-1",
        prRecordId: "pr-record-1"
      })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-1",
        prRecordId: "pr-record-1",
        confidence: 0.91,
        status: "APPROVED",
        impact: "The queue worker owns retries and isolation for merged PR analysis."
      })
    );

    const result = await service.analyzePrContext(buildContext());

    expect(mockPrisma.decisionMemory.create).not.toHaveBeenCalled();
    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "decision-1" }
      })
    );
    expect(result).toMatchObject({
      status: "processed",
      decision: {
        id: "decision-1",
        status: "APPROVED"
      }
    });
  });

  it("keeps structured fallback extraction pending even above the approval threshold", async () => {
    const aiProvider = {
      extractDecision: vi.fn().mockResolvedValue(
        buildExtractedDecision({
          confidence: 0.99,
          extractionMethod: "STRUCTURED_FALLBACK"
        })
      )
    };
    const service = new DecisionService(aiProvider);

    mockPrisma.pullRequestRecord.upsert.mockResolvedValue({ id: "pr-record-fallback" });
    mockPrisma.decisionMemory.findFirst.mockResolvedValue(null);
    mockPrisma.decisionMemory.create.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-fallback",
        status: "PENDING",
        extractionMethod: "STRUCTURED_FALLBACK"
      })
    );

    await service.analyzePrContext(buildContext());

    expect(mockPrisma.decisionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          extractionMethod: "STRUCTURED_FALLBACK"
        })
      })
    );
  });

  it("approves a high-confidence decision when review discussion contains the reason", async () => {
    const aiProvider = {
      extractDecision: vi.fn().mockResolvedValue(
        buildExtractedDecision({
          confidence: 0.91,
          reason:
            "Only admin routes need this validation, so keeping the check at the route layer avoids changing public request paths."
        })
      )
    };
    const service = new DecisionService(aiProvider);

    mockPrisma.pullRequestRecord.upsert.mockResolvedValue({ id: "pr-record-discussion" });
    mockPrisma.decisionMemory.findFirst.mockResolvedValue(null);
    mockPrisma.decisionMemory.create.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-discussion",
        status: "APPROVED",
        confidence: 0.91
      })
    );

    await service.analyzePrContext(
      buildContext({
        description: "",
        title: "Validate admin routes at the route layer",
        reviewComments: [
          "Why not use global middleware?",
          "Because only admin routes need this validation, and middleware would affect every request."
        ]
      })
    );

    expect(mockPrisma.decisionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          confidence: 0.91
        })
      })
    );
  });

  it("keeps high-confidence extractions pending when the PR has no explicit reason", async () => {
    const aiProvider = {
      extractDecision: vi.fn().mockResolvedValue(
        buildExtractedDecision({
          confidence: 0.99,
          reason: "This auth rewrite improves security and reliability."
        })
      )
    };
    const service = new DecisionService(aiProvider);

    mockPrisma.pullRequestRecord.upsert.mockResolvedValue({ id: "pr-record-missing-reason" });
    mockPrisma.decisionMemory.findFirst.mockResolvedValue(null);
    mockPrisma.decisionMemory.create.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-missing-reason",
        status: "PENDING",
        confidence: 0.49,
        reason: MISSING_REASON
      })
    );

    const result = await service.analyzePrContext(
      buildContext({
        title: "Rewrite authentication token handling",
        description: "",
        reviewComments: [],
        filesChanged: Array.from({ length: 25 }, (_, index) => `apps/backend/src/auth/file-${index}.ts`),
        diffSummary: "Large auth rewrite touching token refresh and protected routes."
      })
    );

    expect(mockPrisma.decisionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          reason: MISSING_REASON,
          confidence: 0.49
        })
      })
    );
    expect(result.decision).toMatchObject({
      status: "PENDING",
      reason: MISSING_REASON,
      reviewReason: "MISSING_EXPLANATION"
    });
  });

  it("approves a pending decision with edits", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-approve" })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-approve",
        decision: "Use BullMQ for PR analysis",
        reason: "We need retries outside the request path.",
        impact: "Merged PR analysis can scale independently.",
        status: "APPROVED"
      })
    );

    const result = await service.approveDecision("decision-approve", {
      decision: "Use BullMQ for PR analysis",
      reason: "We need retries outside the request path.",
      impact: "Merged PR analysis can scale independently."
    });

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-approve" },
      data: expect.objectContaining({
        decision: "Use BullMQ for PR analysis",
        reason: "We need retries outside the request path.",
        impact: "Merged PR analysis can scale independently.",
        status: "APPROVED",
        approvedByLogin: null,
        approvedAt: expect.any(Date)
      })
    });
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "APPROVED", actorLogin: "system" })
      })
    );
    expect(result.status).toBe("APPROVED");
  });

  it("updates a pending decision without changing its review status", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-draft" })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-draft",
        decision: "Log BullMQ worker startup for async decision processing",
        reason: "Startup visibility helps verify that queue processing is active before merged PRs arrive.",
        impact: "Reviewers can confirm pending decisions are backed by a running worker.",
        status: "PENDING"
      })
    );

    const result = await service.updateDecision("decision-draft", {
      decision: "Log BullMQ worker startup for async decision processing",
      reason: "Startup visibility helps verify that queue processing is active before merged PRs arrive.",
      impact: "Reviewers can confirm pending decisions are backed by a running worker."
    });

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-draft" },
      data: expect.objectContaining({
        decision: "Log BullMQ worker startup for async decision processing",
        reason: "Startup visibility helps verify that queue processing is active before merged PRs arrive.",
        impact: "Reviewers can confirm pending decisions are backed by a running worker.",
        lastEditedByLogin: null
      })
    });
    expect(result.status).toBe("PENDING");
  });

  it("rejects a pending decision", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-reject" })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-reject",
        status: "REJECTED"
      })
    );

    const result = await service.rejectDecision("decision-reject");

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-reject" },
      data: expect.objectContaining({
        status: "REJECTED",
        rejectedByLogin: null,
        rejectedAt: expect.any(Date)
      })
    });
    expect(result.status).toBe("REJECTED");
  });

  it("records the authenticated PR author who approves a decision", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });
    const actor = {
      authRequired: true,
      user: {
        id: "user-maya",
        githubId: "101",
        login: "maya.dev",
        name: "Maya",
        avatarUrl: null,
        role: "VIEWER" as const
      }
    };

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-author-approve" })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-author-approve",
        status: "APPROVED",
        approvedByUserId: actor.user.id,
        approvedByLogin: actor.user.login,
        approvedAt: new Date("2026-06-22T08:00:00.000Z"),
        lastEditedByUserId: actor.user.id,
        lastEditedByLogin: actor.user.login
      })
    );

    const result = await service.approveDecision(
      "decision-author-approve",
      { decision: "Use BullMQ for PR analysis" },
      actor
    );

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-author-approve" },
      data: expect.objectContaining({
        approvedByUserId: "user-maya",
        approvedByLogin: "maya.dev",
        lastEditedByLogin: "maya.dev"
      })
    });
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "APPROVED",
          actorUserId: "user-maya",
          actorLogin: "maya.dev"
        })
      })
    );
    expect(result).toMatchObject({
      status: "APPROVED",
      approvedByLogin: "maya.dev"
    });
  });

  it("denies an unrelated viewer when GitHub auth is required", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-private-review" })
    );

    await expect(
      service.updateDecision(
        "decision-private-review",
        { reason: "Unrelated edit" },
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

  it("allows a configured reviewer to review any pending decision", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-reviewer-edit" })
    );
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-reviewer-edit",
        reason: "Reviewed by the platform team.",
        lastEditedByUserId: "user-reviewer",
        lastEditedByLogin: "platform-reviewer"
      })
    );

    const result = await service.updateDecision(
      "decision-reviewer-edit",
      { reason: "Reviewed by the platform team." },
      {
        authRequired: true,
        user: {
          id: "user-reviewer",
          githubId: "303",
          login: "platform-reviewer",
          name: null,
          avatarUrl: null,
          role: "REVIEWER"
        }
      }
    );

    expect(result.lastEditedByLogin).toBe("platform-reviewer");
  });

  it("returns review permissions for captured PR participants", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-reviewer-permissions" })
    );

    const result = await service.getDecision("decision-reviewer-permissions", {
      authRequired: true,
      user: {
        id: "user-lee",
        githubId: "606",
        login: "lee.dev",
        name: null,
        avatarUrl: null,
        role: "VIEWER"
      }
    });

    expect(mockPrisma.decisionMemory.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ prRecord: true })
      })
    );
    expect(result).toMatchObject({
      id: "decision-reviewer-permissions",
      reviewPermissions: {
        canReview: true,
        canReopen: false
      }
    });
    expect(result).not.toHaveProperty("prRecord");
    expect(result).not.toHaveProperty("auditLogs");
  });

  it("does not grant review permissions to unrelated viewers", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ id: "decision-viewer-permissions" })
    );

    const result = await service.getDecision("decision-viewer-permissions", {
      authRequired: true,
      user: {
        id: "user-outsider",
        githubId: "707",
        login: "outsider",
        name: null,
        avatarUrl: null,
        role: "VIEWER"
      }
    });

    expect(result?.reviewPermissions).toEqual({
      canReview: false,
      canReopen: false
    });
  });

  it("returns the newest decision audit activity first", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue({ id: "decision-audit" });
    mockPrisma.decisionAuditLog.findMany.mockResolvedValue([
      {
        id: "audit-2",
        decisionId: "decision-audit",
        action: "APPROVED",
        actorLogin: "maya.dev",
        createdAt: new Date("2026-06-22T08:10:00.000Z")
      },
      {
        id: "audit-1",
        decisionId: "decision-audit",
        action: "EDITED",
        actorLogin: "maya.dev",
        createdAt: new Date("2026-06-22T08:00:00.000Z")
      }
    ]);

    const result = await service.listAuditLogs("decision-audit");

    expect(mockPrisma.decisionAuditLog.findMany).toHaveBeenCalledWith({
      where: { decisionId: "decision-audit" },
      orderBy: { createdAt: "desc" }
    });
    expect(result.map((entry) => entry.action)).toEqual(["APPROVED", "EDITED"]);
    expect(result[0]?.createdAt).toBe("2026-06-22T08:10:00.000Z");
  });

  it("rejects review actions for decisions that are no longer pending", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildReviewableDecisionRecord({ status: "APPROVED" })
    );

    await expect(
      service.updateDecision("decision-approved", {
        decision: "Refine approved decision"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Only pending decisions can be edited"
    });

    await expect(
      service.approveDecision("decision-approved", {
        decision: "Approve again"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Only pending decisions can be approved"
    });

    await expect(service.rejectDecision("decision-approved")).rejects.toMatchObject({
      statusCode: 409,
      message: "Only pending decisions can be rejected"
    });

    expect(mockPrisma.decisionMemory.update).not.toHaveBeenCalled();
  });

  it("lets a maintainer reopen a completed review with an audited reason", async () => {
    const service = new DecisionService({ extractDecision: vi.fn() });
    const actor = {
      authRequired: true,
      user: {
        id: "user-maintainer",
        githubId: "404",
        login: "platform-maintainer",
        name: null,
        avatarUrl: null,
        role: "MAINTAINER" as const
      }
    };
    const approvedDecision = buildDecisionRecord({
      id: "decision-reopen",
      status: "APPROVED",
      approvedByUserId: "user-reviewer",
      approvedByLogin: "platform-reviewer",
      approvedAt: new Date("2026-06-22T08:00:00.000Z")
    });

    mockPrisma.decisionMemory.findUnique.mockResolvedValue(approvedDecision);
    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({ id: "decision-reopen", status: "PENDING" })
    );

    const result = await service.reopenDecision(
      "decision-reopen",
      { reason: "The architecture changed after the original review." },
      actor
    );

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-reopen" },
      data: expect.objectContaining({
        status: "PENDING",
        approvedByLogin: null,
        rejectedByLogin: null
      })
    });
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REOPENED",
          actorLogin: "platform-maintainer",
          note: "The architecture changed after the original review."
        })
      })
    );
    expect(result.status).toBe("PENDING");
    expect(result.reviewReason).toBe("REVIEW_REOPENED");
  });

  it("does not let a reviewer reopen a completed review", async () => {
    const service = new DecisionService({ extractDecision: vi.fn() });
    mockPrisma.decisionMemory.findUnique.mockResolvedValue(
      buildDecisionRecord({ id: "decision-no-reopen", status: "REJECTED" })
    );

    await expect(
      service.reopenDecision(
        "decision-no-reopen",
        { reason: "Request another review after new evidence." },
        {
          authRequired: true,
          user: {
            id: "user-reviewer",
            githubId: "505",
            login: "platform-reviewer",
            name: null,
            avatarUrl: null,
            role: "REVIEWER"
          }
        }
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockPrisma.decisionMemory.update).not.toHaveBeenCalled();
  });
});
