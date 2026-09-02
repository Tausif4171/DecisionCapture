import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { MISSING_IMPACT, MISSING_REASON } from "../decisions/evidence.js";
import { resolvePrimaryCategory } from "../decisions/scoring.js";
import type { AIProvider } from "./provider.js";
import {
  cleanStructuredSection,
  confidenceForStructuredSections,
  extractStructuredSections,
  type StructuredDecisionSections
} from "./structured-sections.js";

function fallbackConfidence(sections: StructuredDecisionSections, context: PRContext) {
  const discussionBoost = (context.reviewComments?.length ?? 0) > 0 ? 0.03 : 0;

  return Math.min(0.69, confidenceForStructuredSections(sections) + discussionBoost);
}

export class HeuristicAIProvider implements AIProvider {
  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
    const sections = extractStructuredSections(context);

    return {
      decision: sections.decision ?? cleanStructuredSection(context.title),
      reason: sections.reason ?? MISSING_REASON,
      alternative: sections.alternative,
      impact: sections.impact ?? MISSING_IMPACT,
      author: context.author,
      source: `PR #${context.prNumber}`,
      confidence: fallbackConfidence(sections, context),
      category: resolvePrimaryCategory(context, score),
      extractionMethod: "STRUCTURED_FALLBACK"
    };
  }
}
