import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { AIProvider } from "./provider.js";

const extractedDecisionSchema = z.object({
  decision: z.string().min(1),
  reason: z.string().min(1),
  alternative: z.string().optional(),
  impact: z.string().min(1),
  confidence: z.number().min(0).max(1),
  category: z.string().min(1).default("architecture")
});

function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Ollama response did not include a JSON object");
  }

  return JSON.parse(match[0]) as unknown;
}

function buildPrompt(context: PRContext, score: DecisionScore) {
  return `
You are DecisionCapture, an engineering memory system.
Extract one meaningful technical decision from this merged GitHub PR.
Return strict JSON only. No markdown.

JSON shape:
{
  "decision": "short decision statement",
  "reason": "why this decision was made",
  "alternative": "main alternative considered",
  "impact": "engineering impact",
  "confidence": 0.0,
  "category": "database|api|architecture|dependencies|security|performance|infrastructure|collaboration"
}

Decision score: ${score.score}
Signals: ${score.reasons.join("; ")}

PR:
${JSON.stringify(context, null, 2)}
`.trim();
}

export class OllamaAIProvider implements AIProvider {
  constructor(private readonly fallback?: AIProvider) {}

  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch(`${env.OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          stream: false,
          format: "json",
          prompt: buildPrompt(context, score)
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama responded with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { response?: string };
      const parsed = extractedDecisionSchema.parse(extractJson(payload.response ?? ""));

      return {
        ...parsed,
        author: context.author,
        source: `PR #${context.prNumber}`,
        extractionMethod: "OLLAMA"
      };
    } catch (error) {
      logger.warn({ err: error }, "Ollama extraction failed; using structured PR fallback");

      if (this.fallback && env.USE_HEURISTIC_AI_FALLBACK) {
        return this.fallback.extractDecision(context, score);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
