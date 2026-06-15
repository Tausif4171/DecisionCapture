import { describe, expect, it } from "vitest";
import type { DecisionScore, PRContext } from "@decisioncapture/shared";
import { HeuristicAIProvider } from "../src/modules/ai/heuristic.provider.js";

describe("HeuristicAIProvider", () => {
  it("extracts a Redis queue decision from PR context", async () => {
    const provider = new HeuristicAIProvider();
    const context: PRContext = {
      prNumber: 123,
      title: "Add Redis queue",
      description: "Use BullMQ so PR analysis has retries.",
      author: "maya",
      url: "https://github.com/acme/platform/pull/123",
      repository: "acme/platform",
      filesChanged: ["apps/backend/src/modules/queue/queue.ts", "package.json"],
      reviewComments: ["Webhook requests should stay fast."]
    };
    const score: DecisionScore = {
      score: 75,
      threshold: 35,
      shouldAnalyze: true,
      categories: ["infrastructure", "architecture"],
      reasons: ["Queue added"]
    };

    const extracted = await provider.extractDecision(context, score);

    expect(extracted.decision).toContain("Redis");
    expect(extracted.reason).toContain("request path");
    expect(extracted.confidence).toBeGreaterThan(0.7);
  });
});
