import { describe, expect, it } from "vitest";
import { rankRelationshipCandidates } from "../src/modules/relationships/candidates.js";
import type { RelationshipDecisionInput } from "../src/modules/relationships/types.js";

function decision(overrides: Partial<RelationshipDecisionInput> = {}): RelationshipDecisionInput {
  return {
    id: "decision-source",
    decision: "Use BullMQ for asynchronous decision analysis",
    reason: "PR ingestion should return quickly while analysis retries outside the request path.",
    alternative: "Analyze every pull request inline.",
    impact: "Analysis failures can retry without blocking GitHub ingestion.",
    category: "infrastructure",
    repository: "acme/platform",
    sourcePR: "PR #20",
    filesChanged: ["apps/backend/src/modules/queue/queue.ts"],
    contextLabels: ["https://github.com/acme/platform/issues/10"],
    createdAt: "2026-09-05T10:00:00.000Z",
    ...overrides
  };
}

describe("relationship candidate ranking", () => {
  it("prioritizes concrete shared files and linked context", () => {
    const ranked = rankRelationshipCandidates(
      decision(),
      [
        decision({
          id: "unrelated",
          decision: "Adopt a new dashboard color palette",
          reason: "The product needs stronger visual contrast.",
          alternative: null,
          impact: "Dashboard colors change.",
          category: "collaboration",
          filesChanged: ["apps/frontend/app/globals.css"],
          contextLabels: [],
          createdAt: "2026-09-04T10:00:00.000Z"
        }),
        decision({
          id: "related",
          decision: "Run PR processing through a Redis-backed worker",
          filesChanged: ["apps/backend/src/modules/queue/queue.ts"],
          createdAt: "2026-09-03T10:00:00.000Z"
        })
      ],
      12
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["related"]);
    expect(ranked[0]?.relevanceSignals).toContain(
      "Shared file: apps/backend/src/modules/queue/queue.ts"
    );
    expect(ranked[0]?.relevanceSignals).toContain(
      "Shared context: https://github.com/acme/platform/issues/10"
    );
  });

  it("keeps the candidate set bounded and excludes weak matches", () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      decision({
        id: `candidate-${index}`,
        filesChanged: [`apps/backend/src/modules/queue/file-${index}.ts`],
        contextLabels: [],
        createdAt: new Date(Date.UTC(2026, 8, 4, 10, 0, index)).toISOString()
      })
    );
    candidates.push(
      decision({
        id: "weak",
        decision: "Rename a marketing heading",
        reason: "The old heading is unclear.",
        alternative: null,
        impact: "Copy changes.",
        category: "collaboration",
        filesChanged: ["README.md"],
        contextLabels: []
      })
    );

    const ranked = rankRelationshipCandidates(decision(), candidates, 5);

    expect(ranked).toHaveLength(5);
    expect(ranked.some((candidate) => candidate.id === "weak")).toBe(false);
  });
});
