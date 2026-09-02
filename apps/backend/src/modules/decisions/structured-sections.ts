export type DecisionSectionKey = "decision" | "reason" | "alternative" | "impact";

export type DecisionSections = Partial<Record<DecisionSectionKey, string>>;

const INLINE_SECTION_PATTERN = /\b(decision|reason|alternatives?|impact)\s*:/gi;
const MARKDOWN_SECTION_PATTERN =
  /^ {0,3}#{1,6}\s+[*_`]*(decision|reason|alternatives?|impact)[*_`]*\s*:?\s*#*\s*$/gim;

function sectionKey(label: string | undefined): DecisionSectionKey | undefined {
  if (!label) {
    return undefined;
  }

  const normalized = label.toLowerCase();
  return normalized.startsWith("alternative") ? "alternative" : (normalized as DecisionSectionKey);
}

function stripFencedCode(text: string) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
}

export function cleanStructuredSection(value: string) {
  return value
    .trim()
    .replace(/^[*_`]+\s*/, "")
    .replace(/\s*[*_`]+$/, "")
    .replace(/^[\s\-–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStructuredSections(text: string): DecisionSections {
  const source = stripFencedCode(text);
  const markdownMatches = [...source.matchAll(MARKDOWN_SECTION_PATTERN)].map((match) => ({
    index: match.index ?? 0,
    length: match[0].length,
    key: sectionKey(match[1])
  }));
  const inlineMatches = [...source.matchAll(INLINE_SECTION_PATTERN)]
    .filter((match) => {
      const index = match.index ?? 0;
      return !markdownMatches.some(
        (markdownMatch) => index >= markdownMatch.index && index < markdownMatch.index + markdownMatch.length
      );
    })
    .map((match) => ({
      index: match.index ?? 0,
      length: match[0].length,
      key: sectionKey(match[1])
    }));
  const matches = [...markdownMatches, ...inlineMatches].sort((left, right) => left.index - right.index);
  const sections: DecisionSections = {};

  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? source.length;
    const value = cleanStructuredSection(source.slice(match.index + match.length, end));

    if (value && match.key && !sections[match.key]) {
      sections[match.key] = value;
    }
  });

  return sections;
}
