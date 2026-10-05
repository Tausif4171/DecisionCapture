import { createHash } from "node:crypto";
import type { DecisionMemory, PRContext } from "@decisioncapture/shared";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "because",
  "before",
  "change",
  "changes",
  "create",
  "from",
  "into",
  "that",
  "their",
  "these",
  "this",
  "with"
]);

function compact(value: string | null | undefined, limit: number) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > limit ? `${normalized.slice(0, limit).trimEnd()} [truncated]` : normalized;
}

export function conflictSearchTerms(value: string) {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_./:-]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
  )].slice(0, 40);
}

export function buildConflictPrText(context: PRContext) {
  return [
    `Title: ${compact(context.title, 500)}`,
    `Description: ${compact(context.description, 4_000)}`,
    `Files: ${context.filesChanged.slice(0, 40).join(", ")}`,
    `Labels: ${(context.labels ?? []).slice(0, 20).join(", ")}`,
    `Diff: ${compact(context.diffSummary, 3_000)}`
  ].join("\n");
}

export function buildDecisionText(decision: Pick<DecisionMemory, "decision" | "reason" | "alternative" | "impact" | "category" | "filesChanged">) {
  return [
    `Decision: ${compact(decision.decision, 1_000)}`,
    `Reason: ${compact(decision.reason, 2_000)}`,
    `Alternative: ${compact(decision.alternative, 1_000)}`,
    `Impact: ${compact(decision.impact, 1_500)}`,
    `Category: ${decision.category}`,
    `Files: ${decision.filesChanged.slice(0, 40).join(", ")}`
  ].join("\n");
}

export function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
