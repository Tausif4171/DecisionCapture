import { HttpError } from "../../middleware/error.js";
import { prisma } from "../database/prisma.js";
import type { RelationshipCandidate, RelationshipDecisionInput } from "./types.js";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "decision",
  "from",
  "have",
  "into",
  "should",
  "that",
  "their",
  "this",
  "through",
  "using",
  "were",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would"
]);

type CandidateRecord = {
  id: string;
  decision: string;
  reason: string;
  alternative: string | null;
  impact: string;
  category: string;
  repository: string;
  sourcePR: string;
  filesChanged: string[];
  createdAt: Date;
  contextLinks: Array<{
    externalContext: {
      title: string | null;
      normalizedUrl: string;
    };
  }>;
};

function tokens(value: string) {
  return new Set(
    value
      .slice(0, 12_000)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

function sharedValues(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => right.has(value));
}

function codeArea(file: string) {
  const segments = file.split("/").filter(Boolean);
  return segments.slice(0, Math.min(4, Math.max(1, segments.length - 1))).join("/");
}

function contextLabels(record: CandidateRecord) {
  return record.contextLinks.flatMap((link) =>
    [link.externalContext.normalizedUrl, link.externalContext.title].filter(
      (value): value is string => Boolean(value)
    )
  );
}

function toInput(record: CandidateRecord): RelationshipDecisionInput {
  return {
    id: record.id,
    decision: record.decision,
    reason: record.reason,
    alternative: record.alternative,
    impact: record.impact,
    category: record.category,
    repository: record.repository,
    sourcePR: record.sourcePR,
    filesChanged: record.filesChanged,
    contextLabels: contextLabels(record),
    createdAt: record.createdAt.toISOString()
  };
}

export function rankRelationshipCandidates(
  source: RelationshipDecisionInput,
  candidates: RelationshipDecisionInput[],
  limit: number
): RelationshipCandidate[] {
  const sourceText = tokens(
    [source.decision, source.reason, source.alternative, source.impact].filter(Boolean).join(" ")
  );
  const sourceFiles = new Set(source.filesChanged);
  const sourceAreas = new Set(source.filesChanged.map(codeArea));
  const sourceContexts = new Set(source.contextLabels.map((value) => value.toLowerCase()));

  return candidates
    .map((candidate) => {
      let relevance = 0;
      const relevanceSignals: string[] = [];

      if (source.category === candidate.category) {
        relevance += 0.2;
        relevanceSignals.push(`Same category: ${source.category}`);
      }

      const matchingFiles = candidate.filesChanged.filter((file) => sourceFiles.has(file));
      if (matchingFiles.length) {
        relevance += Math.min(0.45, 0.35 + matchingFiles.length * 0.05);
        relevanceSignals.push(`Shared file: ${matchingFiles[0]}`);
      } else {
        const matchingArea = candidate.filesChanged.map(codeArea).find((area) => sourceAreas.has(area));
        if (matchingArea) {
          relevance += 0.15;
          relevanceSignals.push(`Shared code area: ${matchingArea}`);
        }
      }

      const candidateText = tokens(
        [candidate.decision, candidate.reason, candidate.alternative, candidate.impact]
          .filter(Boolean)
          .join(" ")
      );
      const matchingTerms = sharedValues(sourceText, candidateText);
      if (matchingTerms.length >= 2) {
        const overlap = matchingTerms.length / Math.max(1, Math.min(sourceText.size, candidateText.size));
        relevance += Math.min(0.3, overlap * 0.3);
        relevanceSignals.push(`Overlapping terms: ${matchingTerms.slice(0, 5).join(", ")}`);
      }

      const matchingContext = candidate.contextLabels.find((label) =>
        sourceContexts.has(label.toLowerCase())
      );
      if (matchingContext) {
        relevance += 0.45;
        relevanceSignals.push(`Shared context: ${matchingContext}`);
      }

      return {
        ...candidate,
        relevance: Math.min(1, relevance),
        relevanceSignals
      };
    })
    .filter((candidate) => candidate.relevance >= 0.15)
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, limit);
}

export async function selectRelationshipCandidates(decisionId: string, limit: number) {
  const source = await prisma.decisionMemory.findUnique({
    where: { id: decisionId },
    include: {
      contextLinks: {
        include: { externalContext: true }
      }
    }
  });

  if (!source) {
    throw new HttpError(404, "Decision not found");
  }

  if (source.status !== "APPROVED") {
    throw new HttpError(409, "Only approved decisions can be analyzed for relationships");
  }

  const records = await prisma.decisionMemory.findMany({
    where: {
      id: { not: decisionId },
      repository: source.repository,
      status: "APPROVED",
      createdAt: { lte: source.createdAt }
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: {
      contextLinks: {
        include: { externalContext: true }
      }
    }
  });

  const sourceInput = toInput(source);
  return {
    source: sourceInput,
    candidates: rankRelationshipCandidates(sourceInput, records.map(toInput), limit)
  };
}
