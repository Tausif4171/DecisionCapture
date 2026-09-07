import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  decisionMemory: {
    findUnique: vi.fn()
  },
  decisionRelationshipAnalysis: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn()
  },
  decisionRelationship: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn()
  },
  decisionAuditLog: {
    create: vi.fn()
  }
}));

const mockCandidates = vi.hoisted(() => ({
  selectRelationshipCandidates: vi.fn()
}));

vi.mock("../src/modules/database/prisma.js", () => ({ prisma: mockPrisma }));
vi.mock("../src/modules/relationships/candidates.js", () => mockCandidates);

import { env } from "../src/config/env.js";
import { DecisionRelationshipService } from "../src/modules/relationships/service.js";

const originalEnabled = env.RELATIONSHIP_ANALYSIS_ENABLED;

function analysis(status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED") {
  return {
    id: "analysis-1",
    decisionId: "decision-new",
    status,
    analysisVersion: "v3.1",
    candidateCount: status === "COMPLETED" ? 1 : 0,
    suggestionCount: status === "COMPLETED" ? 1 : 0,
    requestedByLogin: "reviewer",
    lastAttemptAt: new Date("2026-09-05T10:00:00.000Z"),
    lastSuccessAt: status === "COMPLETED" ? new Date("2026-09-05T10:00:01.000Z") : null,
    error: null,
    createdAt: new Date("2026-09-05T10:00:00.000Z"),
    updatedAt: new Date("2026-09-05T10:00:01.000Z")
  };
}

function decision(id: string, createdAt: Date) {
  return {
    id,
    decision: id === "decision-new" ? "Use BullMQ for relationship analysis" : "Use BullMQ for PR analysis",
    reason: "Keep expensive analysis outside the request path.",
    alternative: "Run analysis inline.",
    impact: "Analysis can retry independently.",
    author: "maya",
    sourcePR: id === "decision-new" ? "PR #20" : "PR #10",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/modules/queue/queue.ts"],
    confidence: 0.9,
    status: "APPROVED",
    category: "infrastructure",
    extractionMethod: "OLLAMA",
    prRecordId: null,
    approvedByUserId: null,
    approvedByLogin: null,
    approvedAt: createdAt,
    rejectedByUserId: null,
    rejectedByLogin: null,
    rejectedAt: null,
    lastEditedByUserId: null,
    lastEditedByLogin: null,
    createdAt,
    updatedAt: createdAt
  };
}

function relationship(status: "SUGGESTED" | "ACCEPTED" | "DISMISSED" | "STALE") {
  return {
    id: "relationship-1",
    sourceDecisionId: "decision-new",
    targetDecisionId: "decision-old",
    type: "BUILDS_ON",
    status,
    confidence: 0.86,
    explanation: "The new worker extends the existing asynchronous processing decision.",
    evidence: ["Both decisions keep analysis outside the request path."],
    analysisVersion: "v3.1",
    reviewedByUserId: status === "ACCEPTED" ? "user-1" : null,
    reviewedByLogin: status === "ACCEPTED" ? "reviewer" : null,
    reviewedAt: status === "ACCEPTED" ? new Date("2026-09-05T10:05:00.000Z") : null,
    reviewNote: null,
    createdAt: new Date("2026-09-05T10:00:00.000Z"),
    updatedAt: new Date("2026-09-05T10:00:01.000Z"),
    sourceDecision: decision("decision-new", new Date("2026-09-05T10:00:00.000Z")),
    targetDecision: decision("decision-old", new Date("2026-08-05T10:00:00.000Z"))
  };
}

const source = {
  id: "decision-new",
  decision: "Use BullMQ for relationship analysis",
  reason: "Keep expensive analysis outside the request path.",
  alternative: "Run analysis inline.",
  impact: "Analysis can retry independently.",
  category: "infrastructure",
  repository: "acme/platform",
  sourcePR: "PR #20",
  filesChanged: ["apps/backend/src/modules/queue/queue.ts"],
  contextLabels: [],
  createdAt: "2026-09-05T10:00:00.000Z"
};

const candidate = {
  ...source,
  id: "decision-old",
  decision: "Use BullMQ for PR analysis",
  sourcePR: "PR #10",
  createdAt: "2026-08-05T10:00:00.000Z",
  relevance: 0.8,
  relevanceSignals: ["Shared file: apps/backend/src/modules/queue/queue.ts"]
};

describe("DecisionRelationshipService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.RELATIONSHIP_ANALYSIS_ENABLED = true;
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));
    mockPrisma.decisionRelationshipAnalysis.upsert.mockResolvedValue(analysis("RUNNING"));
    mockPrisma.decisionRelationshipAnalysis.update.mockResolvedValue(analysis("COMPLETED"));
    mockPrisma.decisionRelationship.findMany.mockResolvedValue([]);
    mockPrisma.decisionRelationship.count.mockResolvedValue(1);
    mockPrisma.decisionAuditLog.create.mockResolvedValue({ id: "audit-1" });
    mockCandidates.selectRelationshipCandidates.mockResolvedValue({ source, candidates: [candidate] });
  });

  afterEach(() => {
    env.RELATIONSHIP_ANALYSIS_ENABLED = originalEnabled;
  });

  it("stores an evidence-backed relationship as a suggestion", async () => {
    const provider = {
      analyze: vi.fn().mockResolvedValue([
        {
          targetDecisionId: "decision-old",
          type: "BUILDS_ON",
          confidence: 0.86,
          explanation: "The new worker extends the existing asynchronous processing decision.",
          evidence: ["Both decisions keep analysis outside the request path."]
        }
      ])
    };
    const service = new DecisionRelationshipService(provider);
    mockPrisma.decisionRelationship.findUnique.mockResolvedValue(null);
    mockPrisma.decisionRelationship.create.mockResolvedValue(relationship("SUGGESTED"));

    const result = await service.runAnalysis("decision-new");

    expect(provider.analyze).toHaveBeenCalledWith(source, [candidate]);
    expect(mockPrisma.decisionRelationship.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceDecisionId: "decision-new",
        targetDecisionId: "decision-old",
        type: "BUILDS_ON"
      })
    });
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "RELATIONSHIP_SUGGESTED" })
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("does not overwrite an accepted relationship during re-analysis", async () => {
    const provider = {
      analyze: vi.fn().mockResolvedValue([
        {
          targetDecisionId: "decision-old",
          type: "POSSIBLE_CONFLICT",
          confidence: 0.91,
          explanation: "A later model run interpreted the same pair differently.",
          evidence: ["Both decisions mention the same queue path."]
        }
      ])
    };
    const service = new DecisionRelationshipService(provider);
    mockPrisma.decisionRelationship.findUnique.mockResolvedValue(relationship("ACCEPTED"));

    await service.runAnalysis("decision-new");

    expect(mockPrisma.decisionRelationship.update).not.toHaveBeenCalled();
    expect(mockPrisma.decisionRelationship.create).not.toHaveBeenCalled();
  });

  it("accepts a suggestion with reviewer identity and an audit event", async () => {
    const service = new DecisionRelationshipService({ analyze: vi.fn() });
    mockPrisma.decisionRelationship.findUnique.mockResolvedValue(relationship("SUGGESTED"));
    mockPrisma.decisionRelationship.update.mockResolvedValue(relationship("ACCEPTED"));

    const result = await service.accept(
      "decision-new",
      "relationship-1",
      "The dependency is confirmed in the implementation plan.",
      {
        authRequired: true,
        user: {
          id: "user-1",
          githubId: "1",
          login: "reviewer",
          role: "REVIEWER"
        }
      }
    );

    expect(mockPrisma.decisionRelationship.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACCEPTED",
          reviewedByUserId: "user-1",
          reviewedByLogin: "reviewer"
        })
      })
    );
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "RELATIONSHIP_ACCEPTED" })
    });
    expect(result.status).toBe("ACCEPTED");
  });

  it("prevents viewers from managing relationship suggestions", async () => {
    const service = new DecisionRelationshipService({ analyze: vi.fn() });

    await expect(
      service.accept("decision-new", "relationship-1", undefined, {
        authRequired: true,
        user: {
          id: "viewer-1",
          githubId: "2",
          login: "viewer",
          role: "VIEWER"
        }
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.decisionRelationship.findUnique).not.toHaveBeenCalled();
  });

  it("does not confirm a relationship when either decision is no longer approved", async () => {
    const service = new DecisionRelationshipService({ analyze: vi.fn() });
    mockPrisma.decisionRelationship.findUnique.mockResolvedValue({
      ...relationship("SUGGESTED"),
      targetDecision: {
        ...decision("decision-old", new Date("2026-08-05T10:00:00.000Z")),
        status: "PENDING"
      }
    });

    await expect(
      service.accept("decision-new", "relationship-1", undefined)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockPrisma.decisionRelationship.update).not.toHaveBeenCalled();
  });

  it("marks active relationships stale when a connected decision is reopened", async () => {
    const service = new DecisionRelationshipService({ analyze: vi.fn() });
    mockPrisma.decisionRelationship.findMany.mockResolvedValue([
      {
        id: "relationship-1",
        sourceDecisionId: "decision-new",
        targetDecisionId: "decision-old",
        status: "ACCEPTED"
      }
    ]);

    const affectedSources = await service.invalidateForReopenedDecision("decision-old");

    expect(mockPrisma.decisionRelationship.update).toHaveBeenCalledWith({
      where: { id: "relationship-1" },
      data: { status: "STALE" }
    });
    expect(mockPrisma.decisionAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decisionId: "decision-new",
        action: "RELATIONSHIP_STALE"
      })
    });
    expect(affectedSources).toEqual(["decision-new"]);
  });
});
