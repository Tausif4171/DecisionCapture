import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import { MISSING_IMPACT, MISSING_REASON } from "../decisions/evidence.js";
import { resolvePrimaryCategory } from "../decisions/scoring.js";
import type { AIProvider } from "./provider.js";

type DecisionSections = Partial<Record<"decision" | "reason" | "alternative" | "impact", string>>;

const SECTION_PATTERN = /\b(decision|reason|alternatives?|impact)\s*:/gi;

function cleanSection(value: string) {
  return value
    .trim()
    .replace(/^[*_`]+\s*/, "")
    .replace(/\s*[*_`]+$/, "")
    .replace(/^[\s\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSections(text: string): DecisionSections {
  const matches = [...text.matchAll(SECTION_PATTERN)];
  const sections: DecisionSections = {};

  matches.forEach((match, index) => {
    const rawLabel = match[1]?.toLowerCase();
    const key = rawLabel?.startsWith("alternative") ? "alternative" : rawLabel;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const value = cleanSection(text.slice(start, end));

    if (value && key && !sections[key as keyof DecisionSections]) {
      sections[key as keyof DecisionSections] = value;
    }
  });

  return sections;
}

function mergeSections(context: PRContext) {
  const sources = [context.description ?? "", ...(context.reviewComments ?? [])];

  return sources.reduce<DecisionSections>((combined, source) => {
    const parsed = parseSections(source);

    return {
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
      decision: sections.decision ?? cleanSection(context.title),
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
