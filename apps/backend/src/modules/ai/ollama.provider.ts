import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { MISSING_REASON } from "../decisions/evidence.js";
import { resolvePrimaryCategory } from "../decisions/scoring.js";
import type { AIProvider } from "./provider.js";

export function normalizeOllamaConfidence(value: unknown) {
  if (typeof value === "number") {
    return value > 1 && value <= 100 ? value / 100 : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = Number(trimmed.replace(/%$/, ""));

    if (Number.isFinite(parsed)) {
      return trimmed.endsWith("%") || (parsed > 1 && parsed <= 100) ? parsed / 100 : parsed;
    }
  }

  return value;
}

const extractedDecisionSchema = z.object({
  decision: z.string().min(1),
  reason: z.string().min(1),
  alternative: z.string().optional(),
  impact: z.string().min(1),
  confidence: z.preprocess(normalizeOllamaConfidence, z.number().min(0).max(1)),
  category: z.string().min(1).default("architecture")
});

export function ollamaApiUrl(path: string) {
  return `${env.OLLAMA_BASE_URL.replace(/\/+$/, "")}${path}`;
}

export function ollamaRequestHeaders() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "ngrok-skip-browser-warning": "true",
    "user-agent": "DecisionCapture"
  };
}

export function ollamaBaseUrlDiagnostic() {
  const url = new URL(env.OLLAMA_BASE_URL);
  const localhostNames = new Set(["localhost", "127.0.0.1", "::1"]);
  const pointsAtLocalhost = localhostNames.has(url.hostname);

  return {
    baseUrl: env.OLLAMA_BASE_URL,
    pointsAtLocalhost,
    warning: pointsAtLocalhost
      ? "OLLAMA_BASE_URL points at localhost. In a cloud deployment this means the cloud container, not your laptop."
      : null
  };
}

async function readResponseSnippet(response: Response) {
  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 500);
}

export function isOllamaModelAvailable(configuredModel: string, availableModels: string[]) {
  const candidates = new Set([configuredModel]);

  if (!configuredModel.includes(":")) {
    candidates.add(`${configuredModel}:latest`);
  }

  return availableModels.some((model) => candidates.has(model));
}

export async function checkOllamaHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(env.OLLAMA_REQUEST_TIMEOUT_MS, 10_000));
  const config = ollamaBaseUrlDiagnostic();

  try {
    const response = await fetch(ollamaApiUrl("/api/tags"), {
      method: "GET",
      headers: ollamaRequestHeaders(),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        provider: env.AI_PROVIDER,
        model: env.OLLAMA_MODEL,
        ...config,
        reachable: false,
        status: response.status,
        error: await readResponseSnippet(response)
      };
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    const models =
      payload.models
        ?.map((model) => model.name)
        .filter((model): model is string => Boolean(model)) ?? [];

    return {
      provider: env.AI_PROVIDER,
      model: env.OLLAMA_MODEL,
      ...config,
      reachable: true,
      status: response.status,
      modelAvailable: isOllamaModelAvailable(env.OLLAMA_MODEL, models),
      models
    };
  } catch (error) {
    return {
      provider: env.AI_PROVIDER,
      model: env.OLLAMA_MODEL,
      ...config,
      reachable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Ollama response did not include a JSON object");
  }

  return JSON.parse(match[0]) as unknown;
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value ?? "";
  }

  return `${value.slice(0, maxLength).trimEnd()}\n[truncated]`;
}

function compactList(values: string[] | undefined, maxItems: number, maxLength: number) {
  if (!values?.length) {
    return [];
  }

  const selected: string[] = [];
  let usedLength = 0;

  for (const value of values.slice(0, maxItems)) {
    const remainingLength = maxLength - usedLength;
    if (remainingLength <= 0) {
      break;
    }

    const compacted = truncate(value, Math.min(remainingLength, 500));
    selected.push(compacted);
    usedLength += compacted.length;
  }

  if (selected.length < values.length) {
    selected.push(`[${values.length - selected.length} more omitted]`);
  }

  return selected;
}

function compactContext(context: PRContext) {
  return {
    prNumber: context.prNumber,
    repository: context.repository,
    title: truncate(context.title, 300),
    description: truncate(context.description, 3_000),
    author: context.author,
    filesChanged: compactList(context.filesChanged, 30, 1_500),
    commits: compactList(context.commits, 12, 800),
    reviewers: compactList(context.reviewers, 12, 400),
    reviewComments: compactList(context.reviewComments, 10, 1_800),
    approvals: compactList(context.approvals, 12, 400),
    labels: compactList(context.labels, 12, 400),
    diffSummary: truncate(context.diffSummary, 2_500)
  };
}

export function buildOllamaPrompt(context: PRContext, score: DecisionScore) {
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

Confidence must be a decimal from 0 to 1, for example 0.82. Never return 82 or "82%".
Only use reasoning that is explicitly present in the PR description or review conversation.
Do not invent a reason from file names, diff size, commits, labels, or generic engineering assumptions.
If the PR does not explicitly say why the change was made, set reason exactly to:
"${MISSING_REASON}"
and set confidence no higher than 0.49.

Decision score: ${score.score}
Signals: ${score.reasons.join("; ")}

PR:
${JSON.stringify(compactContext(context), null, 2)}
`.trim();
}

export class OllamaAIProvider implements AIProvider {
  constructor(private readonly fallback?: AIProvider) {}

  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
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
            num_predict: 450
          },
          prompt: buildOllamaPrompt(context, score)
        })
      });

      if (!response.ok) {
        const responseSnippet = await readResponseSnippet(response);
        throw new Error(
          `Ollama responded with HTTP ${response.status}${responseSnippet ? `: ${responseSnippet}` : ""}`
        );
      }

      const payload = (await response.json()) as { response?: string };
      const parsed = extractedDecisionSchema.parse(extractJson(payload.response ?? ""));

      return {
        ...parsed,
        category: resolvePrimaryCategory(context, score),
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
