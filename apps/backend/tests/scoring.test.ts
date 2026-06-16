import { describe, expect, it } from "vitest";
import type { PRContext } from "@decisioncapture/shared";
import { resolveDecisionStatus, scoreDecisionContext } from "../src/modules/decisions/scoring.js";

const baseContext: PRContext = {
  prNumber: 1,
  title: "Update styles",
  description: "",
  author: "dev",
  url: "https://github.com/acme/platform/pull/1",
  repository: "acme/platform",
  filesChanged: []
};

describe("scoreDecisionContext", () => {
  it("scores architecture, infrastructure, and dependency changes above threshold", () => {
    const result = scoreDecisionContext(
      {
        ...baseContext,
        title: "Add Redis queue for async PR analysis",
        filesChanged: ["apps/backend/src/modules/queue/queue.ts", "package.json", "docker-compose.yml"],
        reviewComments: ["We need retries because Ollama can be slow"]
      },
      35
    );

    expect(result.shouldAnalyze).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(35);
    expect(result.categories).toContain("architecture");
    expect(result.categories).toContain("infrastructure");
  });

  it("ignores CSS-only noise", () => {
    const result = scoreDecisionContext(
      {
        ...baseContext,
        title: "Fix button color typo",
        filesChanged: ["apps/frontend/app/globals.css"]
      },
      35
    );

    expect(result.shouldAnalyze).toBe(false);
  });

  it("scores structured PR decision notes without treating a generic queue mention as infrastructure", () => {
    const result = scoreDecisionContext(
      {
        ...baseContext,
        title: "Add decision audit event helper",
        description: `
Decision:
Add a small backend observability helper.

Reason:
Merged PR analysis needs structured audit events.

Alternative:
Use raw log strings inside queue and webhook handlers.

Impact:
Decision capture events stay consistent.
        `,
        filesChanged: ["apps/backend/src/modules/observability/decision-audit.ts"]
      },
      35
    );

    expect(result.shouldAnalyze).toBe(true);
    expect(result.categories).toContain("architecture");
    expect(result.categories).not.toContain("infrastructure");
  });
});

describe("resolveDecisionStatus", () => {
  it("keeps low confidence decisions pending", () => {
    expect(resolveDecisionStatus(0.62, 0.78)).toBe("PENDING");
    expect(resolveDecisionStatus(0.91, 0.78)).toBe("APPROVED");
  });
});
