import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import type { AIProvider } from "./provider.js";

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function confidenceFrom(score: DecisionScore, context: PRContext) {
  const discussionBoost = (context.reviewComments?.length ?? 0) > 0 ? 0.08 : 0;
  return Math.min(0.94, Math.max(0.58, 0.56 + score.score / 180 + discussionBoost));
}

export class HeuristicAIProvider implements AIProvider {
  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
    const text = [
      context.title,
      context.description,
      context.diffSummary,
      ...(context.commits ?? []),
      ...(context.reviewComments ?? []),
      ...context.filesChanged
    ]
      .join("\n")
      .toLowerCase();

    const primaryCategory = score.categories[0] ?? "architecture";

    if (includesAny(text, ["redis", "bullmq", "queue", "worker", "background"])) {
      return {
        decision: "Use a Redis-backed queue for asynchronous PR analysis",
        reason:
          "Merged PR context can be expensive to score and summarize, so the work should run outside the request path with retries and failure isolation.",
        alternative: "Analyze every merged PR synchronously inside the webhook request",
        impact: "Webhook handling stays fast while failed analyses can be retried without losing the PR context.",
        author: context.author,
        source: `PR #${context.prNumber}`,
        confidence: confidenceFrom(score, context),
        category: "infrastructure"
      };
    }

    if (includesAny(text, ["postgres", "prisma", "schema", "migration", ".sql"])) {
      return {
        decision: "Persist engineering decisions in PostgreSQL through Prisma",
        reason:
          "Decision memories need durable storage, queryable metadata, and a schema that can support later semantic search.",
        alternative: "Keep extracted decisions in memory or flat files",
        impact: "The product can support dashboard search, pending review, and future Memory Store export without changing the core data model.",
        author: context.author,
        source: `PR #${context.prNumber}`,
        confidence: confidenceFrom(score, context),
        category: "database"
      };
    }

    if (includesAny(text, ["signature", "hmac", "secret", "token", "auth", "security"])) {
      return {
        decision: "Verify inbound GitHub requests before analysis",
        reason:
          "DecisionCapture receives repository metadata and should reject forged webhook or ingest requests before queueing work.",
        alternative: "Accept any request that matches the expected JSON shape",
        impact: "The backend reduces spoofing risk and avoids storing untrusted decision records.",
        author: context.author,
        source: `PR #${context.prNumber}`,
        confidence: confidenceFrom(score, context),
        category: "security"
      };
    }

    if (includesAny(text, ["endpoint", "route", "api", "controller", "contract"])) {
      return {
        decision: "Expose decision capture through explicit API contracts",
        reason:
          "GitHub Actions, webhooks, demo mode, and the dashboard need stable endpoints with validated payloads.",
        alternative: "Couple capture logic directly to the frontend or a one-off script",
        impact: "Integrations can evolve independently while preserving a clean backend boundary.",
        author: context.author,
        source: `PR #${context.prNumber}`,
        confidence: confidenceFrom(score, context),
        category: "api"
      };
    }

    return {
      decision: `Capture the ${primaryCategory} decision from ${context.title}`,
      reason:
        "The merged PR changed technical behavior in a way that future engineers may need to understand after GitHub discussion context fades.",
      alternative: "Leave the reasoning buried in the merged pull request",
      impact: "The decision becomes searchable from the dashboard with its source PR, author, files, and confidence.",
      author: context.author,
      source: `PR #${context.prNumber}`,
      confidence: confidenceFrom(score, context),
      category: primaryCategory
    };
  }
}
