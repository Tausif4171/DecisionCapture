import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";
import type { AIProvider } from "./provider.js";

type DecisionSection = "decision" | "reason" | "alternative" | "impact";

const sectionAliases: Partial<Record<string, DecisionSection>> = {
  decision: "decision",
  reason: "reason",
  rationale: "reason",
  alternative: "alternative",
  alternatives: "alternative",
  impact: "impact",
  outcome: "impact"
};

function confidenceFrom(score: DecisionScore, context: PRContext) {
  const discussionBoost = (context.reviewComments?.length ?? 0) > 0 ? 0.08 : 0;
  return Math.min(0.94, Math.max(0.58, 0.56 + score.score / 180 + discussionBoost));
}

function cleanText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value: string, fallback = "") {
  const cleaned = cleanText(value)
    .replace(/^\s*[-*]\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return cleaned || fallback;
}

function truncate(value: string, maxLength: number) {
  const cleaned = compact(value);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
}

function parseSectionHeader(line: string) {
  const normalized = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*[-*]\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
  const match = normalized.match(/^([a-z][a-z -]{1,24})\s*:?\s*(.*)$/i);

  const label = match?.[1];
  if (!label) {
    return null;
  }

  const key = label.toLowerCase().replace(/\s+/g, "-");
  const section = sectionAliases[key] ?? sectionAliases[key.replace(/-/g, " ")];

  if (!section) {
    return null;
  }

  return {
    section,
    inlineValue: match[2]?.trim() ?? ""
  };
}

function parseDecisionSections(description?: string) {
  const sections: Partial<Record<DecisionSection, string[]>> = {};
  let currentSection: DecisionSection | null = null;

  for (const line of cleanText(description ?? "").split("\n")) {
    const parsedHeader = parseSectionHeader(line);
    if (parsedHeader) {
      currentSection = parsedHeader.section;
      sections[currentSection] ??= [];
      if (parsedHeader.inlineValue) {
        sections[currentSection]?.push(parsedHeader.inlineValue);
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection]?.push(line);
    }
  }

  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, compact(lines.join("\n"))])
  ) as Partial<Record<DecisionSection, string>>;
}

export function hasStructuredDecisionSections(description?: string) {
  const sections = parseDecisionSections(description);
  return Boolean(sections.decision || sections.reason || sections.alternative || sections.impact);
}

function categoryFromContext(context: PRContext, score: DecisionScore) {
  const files = context.filesChanged ?? [];
  const text = [context.title, context.description, context.diffSummary, ...files]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (files.some((file) => /(^|\/)(prisma|migrations|schema)|\.(sql|prisma)$/i.test(file))) {
    return "database";
  }

  if (/\b(auth|oauth|token|secret|signature|permission|encrypt|security|csrf|hmac)\b/i.test(text)) {
    return "security";
  }

  if (
    files.some((file) => /(Dockerfile|docker-compose|k8s|helm|terraform|infra|deploy|redis|bullmq)/i.test(file)) ||
    /\b(redis|docker|deploy|bullmq|kubernetes|terraform)\b/i.test(text)
  ) {
    return "infrastructure";
  }

  if (files.some((file) => /(api|routes?|controllers?|openapi|swagger)/i.test(file))) {
    return "api";
  }

  return score.categories[0] ?? "architecture";
}

function fallbackReason(context: PRContext, score: DecisionScore) {
  if (context.description) {
    return truncate(context.description, 360);
  }

  if (score.reasons.length) {
    return score.reasons.join("; ");
  }

  return `Merged PR ${context.repository}#${context.prNumber} changed ${context.filesChanged.length} file(s).`;
}

function fallbackImpact(context: PRContext, score: DecisionScore) {
  if (context.diffSummary) {
    return truncate(context.diffSummary, 360);
  }

  if (score.reasons.length) {
    return score.reasons.join("; ");
  }

  const files = context.filesChanged.slice(0, 5).join(", ");
  return files ? `Changed files include ${files}.` : `Captured from merged PR ${context.repository}#${context.prNumber}.`;
}

export class HeuristicAIProvider implements AIProvider {
  async extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision> {
    const sections = parseDecisionSections(context.description);
    const decision = sections.decision ?? context.title;

    return {
      decision: truncate(decision, 180),
      reason: sections.reason ?? fallbackReason(context, score),
      alternative: sections.alternative,
      impact: sections.impact ?? fallbackImpact(context, score),
      author: context.author,
      source: `PR #${context.prNumber}`,
      confidence: confidenceFrom(score, context),
      category: categoryFromContext(context, score)
    };
  }
}
