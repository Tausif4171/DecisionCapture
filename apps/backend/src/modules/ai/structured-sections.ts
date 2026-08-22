import type { PRContext } from "@decisioncapture/shared";

export type StructuredDecisionSections = Partial<
  Record<"decision" | "reason" | "alternative" | "impact", string>
>;

const SECTION_PATTERN = /\b(decision|reason|alternatives?|impact)\s*:/gi;

export function cleanStructuredSection(value: string) {
  return value
    .trim()
    .replace(/^[*_`]+\s*/, "")
    .replace(/\s*[*_`]+$/, "")
    .replace(/^[\s\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStructuredSections(text: string): StructuredDecisionSections {
  const matches = [...text.matchAll(SECTION_PATTERN)];
  const sections: StructuredDecisionSections = {};

  matches.forEach((match, index) => {
    const rawLabel = match[1]?.toLowerCase();
    const key = rawLabel?.startsWith("alternative") ? "alternative" : rawLabel;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const value = cleanStructuredSection(text.slice(start, end));

    if (value && key && !sections[key as keyof StructuredDecisionSections]) {
      sections[key as keyof StructuredDecisionSections] = value;
    }
  });

  return sections;
}

export function extractStructuredSections(
  context: Pick<PRContext, "description" | "reviewComments">
): StructuredDecisionSections {
  return [context.description ?? "", ...(context.reviewComments ?? [])].reduce<StructuredDecisionSections>(
    (combined, source) => {
      const parsed = parseStructuredSections(source);

      return {
        decision: combined.decision ?? parsed.decision,
        reason: combined.reason ?? parsed.reason,
        alternative: combined.alternative ?? parsed.alternative,
        impact: combined.impact ?? parsed.impact
      };
    },
    {}
  );
}

export function confidenceForStructuredSections(sections: StructuredDecisionSections) {
  const explicitSectionCount = Object.values(sections).filter(Boolean).length;

  return Math.min(0.69, 0.43 + explicitSectionCount * 0.055);
}
