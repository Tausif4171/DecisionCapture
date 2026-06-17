import type { DecisionMemory } from "@decisioncapture/shared";

export type DecisionReviewDraft = {
  decision: string;
  reason: string;
  alternative: string;
  impact: string;
};

type ReviewFields = Pick<DecisionMemory, "decision" | "reason" | "alternative" | "impact">;

export function toDecisionReviewDraft(decision: ReviewFields): DecisionReviewDraft {
  return {
    decision: decision.decision,
    reason: decision.reason,
    alternative: decision.alternative ?? "",
    impact: decision.impact
  };
}

export function hasDecisionReviewChanges(decision: ReviewFields, draft: DecisionReviewDraft) {
  return (
    decision.decision !== draft.decision ||
    decision.reason !== draft.reason ||
    (decision.alternative ?? "") !== draft.alternative ||
    decision.impact !== draft.impact
  );
}

export function hasRequiredDecisionReviewFields(draft: DecisionReviewDraft) {
  return draft.decision.trim().length > 0 && draft.reason.trim().length > 0 && draft.impact.trim().length > 0;
}
