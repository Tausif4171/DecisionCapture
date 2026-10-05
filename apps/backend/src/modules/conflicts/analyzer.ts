import { z } from "zod";
import { env } from "../../config/env.js";
import {
  normalizeOllamaConfidence,
  ollamaApiUrl,
  ollamaRequestHeaders
} from "../ai/ollama.provider.js";
import type { ConflictAnalyzer, ConflictAssessment, ConflictCandidate, ConflictPullRequestContext } from "./types.js";

function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Conflict analysis did not return a JSON object");
  }

  return JSON.parse(match[0]) as unknown;
}

function truncate(value: string | null | undefined, limit: number) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()} [truncated]` : normalized;
}

function compactCandidate(candidate: ConflictCandidate) {
  return {
    id: candidate.id,
    status: candidate.status,
    decision: truncate(candidate.decision, 700),
    reason: truncate(candidate.reason, 1_200),
    alternative: truncate(candidate.alternative, 700),
    impact: truncate(candidate.impact, 900),
    category: candidate.category,
    sourcePR: candidate.sourcePR,
    filesChanged: candidate.filesChanged.slice(0, 20),
    similarityScore: candidate.similarityScore
  };
}

export function buildConflictPrompt(context: ConflictPullRequestContext, candidates: ConflictCandidate[]) {
  return `
You are DecisionCapture, an engineering decision safety system.
Determine whether the open pull request may conflict with an earlier engineering decision.
Return strict JSON only. Do not use markdown.

JSON shape:
{
  "assessments": [
    {
      "decisionId": "candidate id",
      "conflict": true,
      "confidence": 0.0,
      "explanation": "careful explanation of the possible contradiction",
      "evidenceFromPr": ["specific evidence from the PR"],
      "evidenceFromDecision": ["specific evidence from the historical decision"]
    }
  ]
}

Rules:
- Only use decisionId values supplied in the candidate list.
- Return conflict=true only when the PR proposes changing the same behavior, policy, or technology in an incompatible direction.
- A shared word, file, category, or topic is not enough.
- A rejected historical decision is valid evidence, but describe it as a possible conflict.
- Do not claim certainty. Engineers must review the warning.
- Every conflict=true result must contain concrete evidence from both sides.
- Omit candidates with insufficient evidence.
- Confidence must be a decimal from 0 to 1.

Open PR:
${JSON.stringify({
    repository: context.repository,
    prNumber: context.prNumber,
    title: truncate(context.title, 500),
    description: truncate(context.description, 4_000),
    filesChanged: context.filesChanged.slice(0, 30),
    diffSummary: truncate(context.diffSummary, 2_500),
    labels: context.labels?.slice(0, 20) ?? []
  }, null, 2)}

Historical candidates:
${JSON.stringify(candidates.map(compactCandidate), null, 2)}
`.trim();
}

const normalizedAssessmentSchema = z.object({
  decisionId: z.string().min(1),
  conflict: z.boolean(),
  confidence: z.preprocess(normalizeOllamaConfidence, z.number().min(0).max(1)),
  explanation: z.string().trim().min(20).max(800),
  evidenceFromPr: z.array(z.string().trim().min(3).max(400)).min(1).max(5),
  evidenceFromDecision: z.array(z.string().trim().min(3).max(400)).min(1).max(5)
});

const normalizedResponseSchema = z.object({
  assessments: z.array(normalizedAssessmentSchema).max(25)
});

export class OllamaConflictAnalyzer implements ConflictAnalyzer {
  async analyze(context: ConflictPullRequestContext, candidates: ConflictCandidate[]): Promise<ConflictAssessment[]> {
    if (!candidates.length) {
      return [];
    }

    if (env.AI_PROVIDER !== "ollama") {
      throw new Error("Conflict analysis requires AI_PROVIDER=ollama");
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
          options: { temperature: 0, num_predict: 1_600 },
          prompt: buildConflictPrompt(context, candidates)
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama conflict analysis failed with HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { response?: string };
      const parsed = normalizedResponseSchema.parse(extractJson(payload.response ?? ""));
      const allowedIds = new Set(candidates.map((candidate) => candidate.id));
      const unique = new Map<string, ConflictAssessment>();

      for (const assessment of parsed.assessments) {
        if (!allowedIds.has(assessment.decisionId) || !assessment.conflict) {
          continue;
        }

        const current = unique.get(assessment.decisionId);
        if (!current || assessment.confidence > current.confidence) {
          unique.set(assessment.decisionId, assessment);
        }
      }

      return [...unique.values()];
    } finally {
      clearTimeout(timeout);
    }
  }
}
