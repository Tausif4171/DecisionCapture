import { describe, expect, it } from "vitest";
import type { DecisionScore, PRContext } from "@decisioncapture/shared";
import { HeuristicAIProvider } from "../src/modules/ai/heuristic.provider.js";

describe("HeuristicAIProvider", () => {
  it("extracts decision fields from structured PR body sections", async () => {
    const provider = new HeuristicAIProvider();
    const context: PRContext = {
      prNumber: 1,
      title: "Add decision audit event helper for capture pipeline",
      description: `
Decision:
Add a small backend observability helper for DecisionCapture audit events.

Reason:
Merged PR analysis needs structured audit events so webhook and GitHub Action ingestion can describe why a decision was captured.

Alternative:
Use raw log strings inside queue and webhook handlers.

Impact:
This keeps decision capture events consistent and easier to search/debug later.
      `,
      author: "Tausif4171",
      url: "https://github.com/Tausif4171/DecisionCapture/pull/1",
      repository: "Tausif4171/DecisionCapture",
      filesChanged: ["apps/backend/src/modules/observability/decision-audit.ts"]
    };
    const score: DecisionScore = {
      score: 75,
      threshold: 35,
      shouldAnalyze: true,
      categories: ["architecture"],
      reasons: ["Architecture or service boundary changed"]
    };

    const extracted = await provider.extractDecision(context, score);

    expect(extracted.decision).toBe("Add a small backend observability helper for DecisionCapture audit events.");
    expect(extracted.reason).toContain("structured audit events");
    expect(extracted.alternative).toBe("Use raw log strings inside queue and webhook handlers.");
    expect(extracted.impact).toContain("consistent and easier to search/debug");
    expect(extracted.category).toBe("architecture");
    expect(extracted.confidence).toBeGreaterThan(0.7);
  });
});
