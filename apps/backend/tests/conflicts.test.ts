import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConflictPrText, conflictSearchTerms, contentHash } from "../src/modules/conflicts/text.js";
import { conflictAssessmentResponseSchema, conflictReviewSchema } from "../src/modules/conflicts/validation.js";
import { buildConflictPrompt, OllamaConflictAnalyzer } from "../src/modules/conflicts/analyzer.js";
import {
  buildConflictScanJobId,
  buildConflictWebhookJobId
} from "../src/modules/conflicts/queue.js";
import type { ConflictCandidate, ConflictPullRequestContext } from "../src/modules/conflicts/types.js";

const context: ConflictPullRequestContext = {
  prNumber: 91,
  title: "Bring back JWT authentication",
  description: "Restore JWT support for the API.",
  author: "maya",
  url: "https://github.com/acme/platform/pull/91",
  repository: "acme/platform",
  filesChanged: ["apps/api/auth.ts"],
  labels: ["security"],
  diffSummary: "+ enable JWT validation",
  action: "opened",
  state: "OPEN",
  draft: false,
  headSha: "sha-91"
};

const rejectedDecision: ConflictCandidate = {
  id: "decision-jwt",
  decision: "Remove JWT authentication",
  reason: "JWT was rejected because its token handling created a security risk.",
  alternative: "Use short-lived, server-managed sessions.",
  impact: "The API does not accept JWT tokens.",
  status: "REJECTED",
  category: "security",
  repository: "acme/platform",
  sourcePR: "PR #42",
  filesChanged: ["apps/api/auth.ts"],
  createdAt: "2026-01-01T00:00:00.000Z",
  similarityScore: 0.91,
  matchMethod: "HYBRID"
};

describe("conflict intelligence boundaries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes search terms and removes common noise", () => {
    expect(conflictSearchTerms("Bring back JWT authentication after API changes")).toEqual([
      "bring",
      "back",
      "jwt",
      "authentication",
      "api"
    ]);
  });

  it("creates a stable content hash for idempotent scans", () => {
    expect(contentHash("same content")).toBe(contentHash("same content"));
    expect(contentHash("same content")).not.toBe(contentHash("changed content"));
    expect(buildConflictPrText(context)).toContain("Bring back JWT authentication");
  });

  it("builds BullMQ-safe deterministic job IDs for webhook and scan work", () => {
    const webhookJobId = buildConflictWebhookJobId("cm-webhook-123");
    const scanJobId = buildConflictScanJobId("cm-scan-456");

    expect(webhookJobId).toBe("conflict-webhook-cm-webhook-123");
    expect(scanJobId).toBe("conflict-scan-cm-scan-456");
    expect(webhookJobId).not.toContain(":");
    expect(scanJobId).not.toContain(":");
  });

  it("requires a bounded, evidence-backed review payload", () => {
    expect(() => conflictReviewSchema.parse({ action: "dismiss", note: "Not the same policy." })).not.toThrow();
    expect(() => conflictReviewSchema.parse({ action: "accept" })).toThrow();
    expect(() =>
      conflictAssessmentResponseSchema.parse({
        assessments: [
          {
            decisionId: "decision-jwt",
            conflict: true,
            confidence: 0.8,
            explanation: "The PR reintroduces the technology rejected by the historical decision.",
            evidenceFromPr: ["The PR enables JWT authentication."],
            evidenceFromDecision: ["The earlier decision rejected JWT for security reasons."]
          }
        ]
      })
    ).not.toThrow();
  });

  it("keeps analyzer output limited to supplied candidates and true conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            assessments: [
              {
                decisionId: "decision-jwt",
                conflict: true,
                confidence: 0.86,
                explanation: "The PR reintroduces the technology rejected by the historical decision.",
                evidenceFromPr: ["The PR enables JWT authentication."],
                evidenceFromDecision: ["The earlier decision rejected JWT for security reasons."]
              },
              {
                decisionId: "unknown-decision",
                conflict: true,
                confidence: 0.99,
                explanation: "This candidate was not supplied to the analyzer and must be ignored.",
                evidenceFromPr: ["Untrusted evidence from an unknown candidate."],
                evidenceFromDecision: ["Untrusted historical evidence."]
              },
              {
                decisionId: "decision-jwt",
                conflict: false,
                confidence: 0.99,
                explanation: "A non-conflict result must not become a warning.",
                evidenceFromPr: ["The PR uses an authentication file."],
                evidenceFromDecision: ["The decision discusses authentication."]
              }
            ]
          })
        })
      })
    );

    const result = await new OllamaConflictAnalyzer().analyze(context, [rejectedDecision]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ decisionId: "decision-jwt", confidence: 0.86 });
  });

  it("tells the model that shared words are not enough", () => {
    const prompt = buildConflictPrompt(context, [rejectedDecision]);
    expect(prompt).toContain("A shared word, file, category, or topic is not enough");
    expect(prompt).toContain("possible conflict");
    expect(prompt).toContain("decision-jwt");
  });
});
