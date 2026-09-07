import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { MISSING_IMPACT, MISSING_REASON } from "../decisions/evidence.js";
import {
  cleanStructuredSection,
  firstStructuredStatement,
  parseStructuredSections,
  type DecisionSections
} from "../decisions/structured-sections.js";
import { resolvePrimaryCategory } from "../decisions/scoring.js";
import type { AIProvider } from "./provider.js";

function mergeSections(context: PRContext) {
  const sources = [context.description ?? "", ...(context.reviewComments ?? [])];

  return sources.reduce<DecisionSections>((combined, source) => {
    const parsed = parseStructuredSections(source);

    return {
      summary: combined.summary ?? parsed.summary,
      decision: combined.decision ?? parsed.decision,
      reason: combined.reason ?? parsed.reason,
      alternative: combined.alternative ?? parsed.alternative,
      impact: combined.impact ?? parsed.impact
    };
  }, {});
}

function fallbackConfidence(sections: DecisionSections, context: PRContext) {
  const explicitSectionCount = Object.values(sections).filter(Boolean).length;
  const discussionBoost = (context.reviewComments?.length ?? 0) > 0 ? 0.03 : 0;

  return Math.min(0.69, 0.43 + explicitSectionCount * 0.055 + discussionBoost);
}

export class HeuristicAIProvider implements AIProvider {
  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
    const sections = mergeSections(context);

    return {
      decision:
        firstStructuredStatement(sections.summary) ||
        firstStructuredStatement(sections.decision) ||
        cleanStructuredSection(context.title),
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
