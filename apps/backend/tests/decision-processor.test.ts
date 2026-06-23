import type { DecisionMemory, PRContext } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDecisionService = vi.hoisted(() => ({
  analyzePrContext: vi.fn()
}));

const mockGitHubService = vi.hoisted(() => ({
  syncDecisionReviewComment: vi.fn()
}));

const mockPrisma = vi.hoisted(() => ({
  pullRequestRecord: {
    findUnique: vi.fn()
  }
}));

vi.mock("../src/modules/decisions/service.js", () => ({
  decisionService: mockDecisionService
}));

vi.mock("../src/modules/github/service.js", () => mockGitHubService);

vi.mock("../src/modules/database/prisma.js", () => ({
  prisma: mockPrisma
}));

import { processDecisionContext, syncDecisionNotificationFromStoredContext } from "../src/modules/decisions/processor.js";

function buildContext(): PRContext {
  return {
    prNumber: 88,
    title: "Introduce review state synchronization",
    description: `Decision: Sync GitHub PR comments from the backend
Reason: Webhook and Action ingestion should notify authors the same way.
Alternative: Let only the Action comment on pending decisions.
Impact: Pending review comments stay consistent across ingestion paths.`,
    mergedAt: "2026-06-16T06:30:00.000Z",
    author: "tausif4171",
    url: "https://github.com/Tausif4171/DecisionCapture/pull/88",
    repository: "Tausif4171/DecisionCapture",
    filesChanged: ["apps/backend/src/modules/decisions/processor.ts"],
    commits: ["feat: sync pending review comments from backend"],
    reviewers: ["reviewer-1"],
    reviewComments: ["Ship it"],
    approvals: ["reviewer-1"],
    labels: ["architecture"],
    diffSummary: "diff --git a/apps/backend/src/modules/decisions/processor.ts b/apps/backend/src/modules/decisions/processor.ts"
  };
}

function buildDecision(overrides: Partial<DecisionMemory> = {}): DecisionMemory {
  return {
    id: "decision-88",
    decision: "Sync GitHub PR comments from the backend",
    reason: "Webhook and Action ingestion should notify authors the same way.",
    alternative: "Let only the Action comment on pending decisions.",
    impact: "Pending review comments stay consistent across ingestion paths.",
    author: "tausif4171",
    sourcePR: "PR #88",
    repository: "Tausif4171/DecisionCapture",
    filesChanged: ["apps/backend/src/modules/decisions/processor.ts"],
    confidence: 0.7,
    status: "PENDING",
    category: "architecture",
    extractionMethod: "OLLAMA",
    prRecordId: "pr-record-88",
    createdAt: "2026-06-16T06:30:00.000Z",
    updatedAt: "2026-06-16T06:30:00.000Z",
    ...overrides
  };
}

describe("decision processing orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs GitHub review comments after a pending decision is processed", async () => {
    const context = buildContext();
    const decision = buildDecision();

    mockDecisionService.analyzePrContext.mockResolvedValue({
      status: "processed",
      decision,
      message: "Decision memory needs author review before approval"
    });

    const result = await processDecisionContext(context);

    expect(mockDecisionService.analyzePrContext).toHaveBeenCalledWith(context);
    expect(mockGitHubService.syncDecisionReviewComment).toHaveBeenCalledWith({
      context,
      decision
    });
    expect(result).toMatchObject({
      status: "processed",
      decision: {
        id: "decision-88"
      }
    });
  });

  it("skips GitHub review comment sync when the result is ignored", async () => {
    mockDecisionService.analyzePrContext.mockResolvedValue({
      status: "ignored",
      message: "PR did not cross the decision-memory threshold"
    });

    const result = await processDecisionContext(buildContext());

    expect(mockGitHubService.syncDecisionReviewComment).not.toHaveBeenCalled();
    expect(result.status).toBe("ignored");
  });

  it("keeps the decision processed when GitHub review comment sync fails", async () => {
    const context = buildContext();
    const decision = buildDecision();

    mockDecisionService.analyzePrContext.mockResolvedValue({
      status: "processed",
      decision,
      message: "Decision memory needs author review before approval"
    });
    mockGitHubService.syncDecisionReviewComment.mockRejectedValue(new Error("GitHub returned 404"));

    const result = await processDecisionContext(context);

    expect(result).toMatchObject({
      status: "processed",
      decision: {
        id: "decision-88"
      }
    });
  });

  it("reloads stored PR context when syncing comment state after approval", async () => {
    const context = buildContext();
    const decision = buildDecision({
      status: "APPROVED"
    });

    mockPrisma.pullRequestRecord.findUnique.mockResolvedValue({
      sourcePayload: context
    });

    await syncDecisionNotificationFromStoredContext(decision);

    expect(mockPrisma.pullRequestRecord.findUnique).toHaveBeenCalledWith({
      where: { id: "pr-record-88" },
      select: { sourcePayload: true }
    });
    expect(mockGitHubService.syncDecisionReviewComment).toHaveBeenCalledWith({
      context,
      decision
    });
  });
});
