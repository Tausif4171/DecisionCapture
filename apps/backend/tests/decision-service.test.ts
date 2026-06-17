import type { ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  pullRequestRecord: {
    upsert: vi.fn()
  },
  decisionMemory: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("../src/modules/database/prisma.js", () => ({
  prisma: mockPrisma
}));

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
    prRecordId: "pr-record-1",
    createdAt: new Date("2026-06-16T06:30:00.000Z"),
    updatedAt: new Date("2026-06-16T06:30:00.000Z"),
    ...overrides
  };
}

describe("DecisionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("approves a pending decision with edits", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

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
      data: {
        decision: "Use BullMQ for PR analysis",
        reason: "We need retries outside the request path.",
        impact: "Merged PR analysis can scale independently.",
        status: "APPROVED"
      }
    });
    expect(result.status).toBe("APPROVED");
  });

  it("rejects a pending decision", async () => {
    const service = new DecisionService({
      extractDecision: vi.fn()
    });

    mockPrisma.decisionMemory.update.mockResolvedValue(
      buildDecisionRecord({
        id: "decision-reject",
        status: "REJECTED"
      })
    );

    const result = await service.rejectDecision("decision-reject");

    expect(mockPrisma.decisionMemory.update).toHaveBeenCalledWith({
      where: { id: "decision-reject" },
      data: {
        status: "REJECTED"
      }
    });
    expect(result.status).toBe("REJECTED");
  });
});
