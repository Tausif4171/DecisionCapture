import type { DecisionScore, PRContext } from "@decisioncapture/shared";
import { describe, expect, it } from "vitest";
import { HeuristicAIProvider } from "../src/modules/ai/heuristic.provider.js";
import {
  buildOllamaPrompt,
  normalizeOllamaConfidence
} from "../src/modules/ai/ollama.provider.js";

const score: DecisionScore = {
  score: 75,
  threshold: 35,
  shouldAnalyze: true,
  categories: ["architecture"],
  reasons: ["Architecture terms found"]
};

function context(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 5,
    title: "Centralize privileged decision review role policy",
    description: `Decision:
Use the shared privileged role policy for decision review authorization.

Reason:
Admin, maintainer, and reviewer access should be defined in one place so permission rules remain consistent.

Alternative:
Keep a separate hardcoded role list inside DecisionService.

Impact:
RBAC rules become easier to maintain and less likely to drift across authorization paths.`,
    author: "Tausif4171",
    url: "https://github.com/Tausif4171/DecisionCapture/pull/5",
    repository: "Tausif4171/DecisionCapture",
    filesChanged: ["apps/backend/src/modules/decisions/service.ts"],
    diffSummary: "import { Prisma } from '@prisma/client';",
    ...overrides
  };
}

describe("HeuristicAIProvider", () => {
  it("uses explicit PR sections instead of canned domain templates", async () => {
    const extracted = await new HeuristicAIProvider().extractDecision(context(), score);

    expect(extracted).toMatchObject({
      decision: "Use the shared privileged role policy for decision review authorization.",
      reason:
        "Admin, maintainer, and reviewer access should be defined in one place so permission rules remain consistent.",
      alternative: "Keep a separate hardcoded role list inside DecisionService.",
      impact: "RBAC rules become easier to maintain and less likely to drift across authorization paths.",
      extractionMethod: "STRUCTURED_FALLBACK"
    });
    expect(extracted.decision).not.toContain("PostgreSQL");
    expect(extracted.confidence).toBeLessThan(0.7);
  });

  it("uses the PR title and honest review placeholders when context is incomplete", async () => {
    const extracted = await new HeuristicAIProvider().extractDecision(
      context({
        title: "Limit dashboard exports to organization members",
        description: "",
        diffSummary: "redis prisma bullmq"
      }),
      score
    );

    expect(extracted.decision).toBe("Limit dashboard exports to organization members");
    expect(extracted.reason).toContain("did not state an explicit reason");
    expect(extracted.impact).toContain("did not state an explicit impact");
    expect(extracted.decision).not.toContain("Redis");
    expect(extracted.decision).not.toContain("PostgreSQL");
  });
});

describe("buildOllamaPrompt", () => {
  it("keeps explicit decision context while bounding very large PR payloads", () => {
    const prompt = buildOllamaPrompt(
      context({
        filesChanged: Array.from(
          { length: 100 },
          (_, index) => `apps/backend/src/modules/example/file-${index}.ts`
        ),
        reviewComments: Array.from({ length: 30 }, () => "Review context ".repeat(80)),
        diffSummary: "large diff line\n".repeat(5_000)
      }),
      score
    );

    expect(prompt).toContain("Use the shared privileged role policy");
    expect(prompt).toContain("Do not invent a reason");
    expect(prompt).toContain("more omitted");
    expect(prompt).toContain("[truncated]");
    expect(prompt.length).toBeLessThan(15_000);
  });
});

describe("normalizeOllamaConfidence", () => {
  it("accepts decimal and percentage-style model confidence values", () => {
    expect(normalizeOllamaConfidence(0.82)).toBe(0.82);
    expect(normalizeOllamaConfidence(82)).toBe(0.82);
    expect(normalizeOllamaConfidence("68%")).toBe(0.68);
    expect(normalizeOllamaConfidence("0.74")).toBe(0.74);
  });

  it("leaves invalid values for schema validation to reject", () => {
    expect(normalizeOllamaConfidence(125)).toBe(125);
    expect(normalizeOllamaConfidence("unknown")).toBe("unknown");
  });
});
