import { Prisma } from "@prisma/client";
import type { DecisionStatus } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { prisma } from "../database/prisma.js";
import { buildConflictPrText, conflictSearchTerms } from "./text.js";
import type { ConflictCandidate, ConflictPullRequestContext } from "./types.js";

function toCandidate(record: {
  id: string;
  decision: string;
  reason: string;
  alternative: string | null;
  impact: string | null;
  status: DecisionStatus;
  category: string;
  repository: string;
  sourcePR: string;
  filesChanged: string[];
  createdAt: Date;
}): ConflictCandidate {
  return {
    ...record,
    createdAt: record.createdAt.toISOString()
  };
}

export async function retrieveConflictCandidates(context: ConflictPullRequestContext) {
  const query = buildConflictPrText(context);
  const terms = conflictSearchTerms(query);
  const fileNames = context.filesChanged.slice(0, 30);
  const categories = [...new Set(
    (context.labels ?? [])
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label.length >= 2)
  )].slice(0, 20);
  const textQuery = terms.join(" ");

  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      decision: string;
      reason: string;
      alternative: string | null;
      impact: string | null;
      status: DecisionStatus;
      category: string;
      repository: string;
      sourcePR: string;
      filesChanged: string[];
      createdAt: Date;
    }>>(Prisma.sql`
      SELECT "id", "decision", "reason", "alternative", "impact", "status", "category", "repository", "sourcePR", "filesChanged", "createdAt"
      FROM "decision_memories"
      WHERE "repository" = ${context.repository}
        AND "status" IN ('APPROVED', 'REJECTED')
        AND (
          ${textQuery ? Prisma.sql`to_tsvector('simple', coalesce("decision", '') || ' ' || coalesce("reason", '') || ' ' || coalesce("alternative", '') || ' ' || coalesce("impact", '')) @@ plainto_tsquery('simple', ${textQuery})` : Prisma.sql`TRUE`}
          ${fileNames.length ? Prisma.sql`OR "filesChanged" && ${fileNames}::text[]` : Prisma.empty}
          ${categories.length ? Prisma.sql`OR lower("category") IN (${Prisma.join(categories)})` : Prisma.empty}
        )
      ORDER BY "createdAt" DESC
      LIMIT ${env.CONFLICT_LEXICAL_CANDIDATE_LIMIT}
    `);

    return rows.map(toCandidate);
  } catch {
    const records = await prisma.decisionMemory.findMany({
      where: {
        repository: context.repository,
        status: { in: ["APPROVED", "REJECTED"] },
        OR: [
          ...terms.slice(0, 12).map((term) => ({ decision: { contains: term, mode: "insensitive" as const } })),
          ...terms.slice(0, 12).map((term) => ({ reason: { contains: term, mode: "insensitive" as const } })),
          ...categories.map((category) => ({ category: { equals: category, mode: "insensitive" as const } })),
          ...(fileNames.length ? [{ filesChanged: { hasSome: fileNames } }] : [])
        ]
      },
      orderBy: { createdAt: "desc" },
      take: env.CONFLICT_LEXICAL_CANDIDATE_LIMIT,
      select: {
        id: true,
        decision: true,
        reason: true,
        alternative: true,
        impact: true,
        status: true,
        category: true,
        repository: true,
        sourcePR: true,
        filesChanged: true,
        createdAt: true
      }
    });

    return records.map(toCandidate);
  }
}
