import { describe, expect, it } from "vitest";
import type { PRContext } from "@decisioncapture/shared";
import {
  resolveDecisionStatus,
  resolvePrimaryCategory,
  scoreDecisionContext
} from "../src/modules/decisions/scoring.js";

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
});

describe("resolveDecisionStatus", () => {
  it("keeps low confidence decisions pending", () => {
    expect(resolveDecisionStatus(0.62, 0.78)).toBe("PENDING");
    expect(resolveDecisionStatus(0.91, 0.78)).toBe("APPROVED");
  });
});

describe("resolvePrimaryCategory", () => {
  it("ranks the PR's architecture intent above incidental database files", () => {
    const context: PRContext = {
      ...baseContext,
      title: "Harden extraction and decision review workflows",
      description:
        "Use conservative structured fallback extraction, audited review reopening, isolated E2E data, and GitHub App authentication.",
      filesChanged: [
        "apps/backend/prisma/schema.prisma",
        "apps/backend/src/modules/ai/ollama.provider.ts",
        "apps/backend/src/modules/decisions/service.ts"
      ]
    };
    const score = scoreDecisionContext(context);

    expect(score.categories).toContain("database");
    expect(score.categories).toContain("architecture");
    expect(resolvePrimaryCategory(context, score)).toBe("architecture");
  });

  it("keeps an explicitly database-focused PR in the database category", () => {
    const context: PRContext = {
      ...baseContext,
      title: "Persist engineering decisions in PostgreSQL through Prisma",
      description: "Add a database schema and migration for durable decision storage.",
      filesChanged: ["apps/backend/prisma/schema.prisma"]
    };
    const score = scoreDecisionContext(context);

    expect(resolvePrimaryCategory(context, score)).toBe("database");
  });
});
