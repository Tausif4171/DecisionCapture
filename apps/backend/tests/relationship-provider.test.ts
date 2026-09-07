import { describe, expect, it } from "vitest";
import { buildRelationshipPrompt } from "../src/modules/relationships/provider.js";
import type {
  RelationshipCandidate,
  RelationshipDecisionInput
} from "../src/modules/relationships/types.js";

const source: RelationshipDecisionInput = {
  id: "decision-new",
  decision: "Use BullMQ for relationship analysis",
  reason: "Reasoning should run outside the request path.",
  alternative: "Run reasoning inline.",
  impact: "Relationship analysis can retry independently.",
  category: "infrastructure",
  repository: "acme/platform",
  sourcePR: "PR #20",
  filesChanged: ["apps/backend/src/modules/relationships/queue.ts"],
  contextLabels: [],
  createdAt: "2026-09-05T10:00:00.000Z"
};

const candidate: RelationshipCandidate = {
  ...source,
  id: "decision-old",
  decision: "Use BullMQ for PR analysis",
  sourcePR: "PR #10",
  createdAt: "2026-08-05T10:00:00.000Z",
  relevance: 0.78,
  relevanceSignals: ["Shared code area: apps/backend/src/modules"]
};

describe("relationship reasoning prompt", () => {
  it("requires cautious, evidence-backed output using only known candidate ids", () => {
    const prompt = buildRelationshipPrompt(source, [candidate]);

    expect(prompt).toContain("Only return a relationship when the supplied text contains concrete evidence");
    expect(prompt).toContain("Use POSSIBLE_CONFLICT instead of claiming a definite conflict");
    expect(prompt).toContain("SUPERSEDES requires explicit replacement evidence");
    expect(prompt).toContain('"id": "decision-old"');
    expect(prompt).toContain("Only use targetDecisionId values from the candidate list");
  });
});
