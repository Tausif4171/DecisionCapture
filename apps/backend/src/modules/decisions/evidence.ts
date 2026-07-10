import type { PRContext } from "@decisioncapture/shared";

export const MISSING_REASON =
  "The PR context did not state an explicit reason. Reviewer confirmation is required.";

export const MISSING_IMPACT =
  "The PR context did not state an explicit impact. Reviewer confirmation is required.";

export type ExplanationEvidenceSource = "DESCRIPTION" | "DISCUSSION" | "MISSING";

export type ExplanationEvidence = {
  hasExplicitReason: boolean;
  source: ExplanationEvidenceSource;
};

const STRUCTURED_REASON_PATTERN = /\b(reason|why|because|rationale)\s*:/i;
const CAUSAL_LANGUAGE_PATTERN =
  /\b(because|so that|in order to|due to|caused|causes|prevent|avoid|reduce|improve|enable|support|fix|address|instead of|rather than|trade[- ]?off|chosen|choose|chose|constraint|need|needs|needed)\b/i;

function normalizeEvidenceText(value: string | undefined) {
  return (value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSubstantiveReasoning(value: string | undefined) {
  const text = normalizeEvidenceText(value);

  if (text.length < 40) {
    return false;
  }

  return STRUCTURED_REASON_PATTERN.test(text) || CAUSAL_LANGUAGE_PATTERN.test(text);
}

export function assessExplanationEvidence(context: PRContext): ExplanationEvidence {
  if (hasSubstantiveReasoning(context.description)) {
    return {
      hasExplicitReason: true,
      source: "DESCRIPTION"
    };
  }

  const hasDiscussionReason = (context.reviewComments ?? []).some(hasSubstantiveReasoning);

  if (hasDiscussionReason) {
    return {
      hasExplicitReason: true,
      source: "DISCUSSION"
    };
  }

  return {
    hasExplicitReason: false,
    source: "MISSING"
  };
}
