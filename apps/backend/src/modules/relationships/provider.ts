import { z } from "zod";
import { env } from "../../config/env.js";
import {
  normalizeOllamaConfidence,
  ollamaApiUrl,
  ollamaRequestHeaders
} from "../ai/ollama.provider.js";
import type {
  RelationshipAssessment,
  RelationshipCandidate,
  RelationshipDecisionInput,
  RelationshipReasoningProvider
} from "./types.js";
import { minimumRelationshipConfidence } from "./validation.js";

const relationshipAssessmentSchema = z.object({
  targetDecisionId: z.string().min(1),
  type: z.enum(["RELATED", "BUILDS_ON", "SUPERSEDES", "POSSIBLE_CONFLICT"]),
  confidence: z.preprocess(normalizeOllamaConfidence, z.number().min(0).max(1)),
  explanation: z.string().trim().min(10).max(600),
  evidence: z.array(z.string().trim().min(3).max(300)).min(1).max(5)
});

const relationshipResponseSchema = z.object({
  relationships: z.array(relationshipAssessmentSchema).max(25)
});

function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Relationship analysis did not return a JSON object");
  }

  return JSON.parse(match[0]) as unknown;
}

function truncate(value: string | null | undefined, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value ?? "";
  }

  return `${value.slice(0, maxLength).trimEnd()}\n[truncated]`;
}

function compactDecision(decision: RelationshipDecisionInput | RelationshipCandidate) {
  return {
    id: decision.id,
    decision: truncate(decision.decision, 500),
    reason: truncate(decision.reason, 1_200),
    alternative: truncate(decision.alternative, 800),
    impact: truncate(decision.impact, 1_000),
    category: decision.category,
    repository: decision.repository,
    sourcePR: decision.sourcePR,
    filesChanged: decision.filesChanged.slice(0, 20),
    contextLabels: decision.contextLabels.slice(0, 10),
    createdAt: decision.createdAt,
    ...("relevance" in decision
      ? {
          relevance: decision.relevance,
          relevanceSignals: decision.relevanceSignals.slice(0, 6)
        }
      : {})
  };
}

export function buildRelationshipPrompt(
  source: RelationshipDecisionInput,
  candidates: RelationshipCandidate[]
) {
  return `
You are reviewing engineering decision memory for possible relationships.
Compare the new source decision with each older candidate decision.
Return strict JSON only. No markdown.

JSON shape:
{
  "relationships": [
    {
      "targetDecisionId": "candidate id",
      "type": "RELATED|BUILDS_ON|SUPERSEDES|POSSIBLE_CONFLICT",
      "confidence": 0.0,
      "explanation": "brief explanation grounded in the supplied decisions",
      "evidence": ["specific fact from the supplied decisions"]
    }
  ]
}

Relationship meanings:
- RELATED: materially addresses the same system, constraint, or engineering concern.
- BUILDS_ON: the source decision extends or depends on the candidate decision.
- SUPERSEDES: the source decision explicitly replaces the candidate decision.
- POSSIBLE_CONFLICT: both decisions appear incompatible and need human review.

Rules:
- Only return a relationship when the supplied text contains concrete evidence.
- Do not infer intent from generic words, category alone, file proximity alone, or recency.
- Use POSSIBLE_CONFLICT instead of claiming a definite conflict.
- SUPERSEDES requires explicit replacement evidence.
- Evidence must quote or closely paraphrase facts present below.
- Omit candidates with insufficient evidence.
- Only use targetDecisionId values from the candidate list.
- Confidence must be a decimal from 0 to 1.

Source decision:
${JSON.stringify(compactDecision(source), null, 2)}

Candidate decisions:
${JSON.stringify(candidates.map(compactDecision), null, 2)}
`.trim();
}

export class OllamaRelationshipReasoningProvider implements RelationshipReasoningProvider {
  async analyze(
    source: RelationshipDecisionInput,
    candidates: RelationshipCandidate[]
  ): Promise<RelationshipAssessment[]> {
    if (!candidates.length) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.OLLAMA_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ollamaApiUrl("/api/generate"), {
        method: "POST",
        headers: ollamaRequestHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          stream: false,
          format: "json",
          keep_alive: "10m",
          options: {
            temperature: 0,
            num_predict: 1_100
          },
          prompt: buildRelationshipPrompt(source, candidates)
        })
      });

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).trim().slice(0, 500);
        throw new Error(
          `Ollama relationship analysis failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
        );
      }

      const payload = (await response.json()) as { response?: string };
      const parsed = relationshipResponseSchema.parse(extractJson(payload.response ?? ""));
      const allowedIds = new Set(candidates.map((candidate) => candidate.id));
      const byTarget = new Map<string, RelationshipAssessment>();

      for (const assessment of parsed.relationships) {
        if (
          !allowedIds.has(assessment.targetDecisionId) ||
          assessment.confidence < minimumRelationshipConfidence(assessment.type)
        ) {
          continue;
        }

        const existing = byTarget.get(assessment.targetDecisionId);
        if (!existing || assessment.confidence > existing.confidence) {
          byTarget.set(assessment.targetDecisionId, assessment);
        }
      }

      return [...byTarget.values()];
    } finally {
      clearTimeout(timeout);
    }
  }
}

class UnsupportedRelationshipReasoningProvider implements RelationshipReasoningProvider {
  async analyze(): Promise<RelationshipAssessment[]> {
    throw new Error("Decision relationship analysis requires AI_PROVIDER=ollama");
  }
}

export function createRelationshipReasoningProvider(): RelationshipReasoningProvider {
  return env.AI_PROVIDER === "ollama"
    ? new OllamaRelationshipReasoningProvider()
    : new UnsupportedRelationshipReasoningProvider();
}
