import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { ollamaApiUrl, ollamaRequestHeaders } from "../ai/ollama.provider.js";
import { prisma } from "../database/prisma.js";
import { buildDecisionText, contentHash, buildConflictPrText } from "./text.js";
import type { ConflictCandidate, ConflictPullRequestContext } from "./types.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

function assertVector(vector: number[]) {
  if (vector.length !== env.CONFLICT_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Embedding dimension mismatch: expected ${env.CONFLICT_EMBEDDING_DIMENSIONS}, received ${vector.length}`
    );
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string) {
    const result = await this.embedMany([text]);
    return result[0] ?? [];
  }

  async embedMany(texts: string[]) {
    if (!texts.length) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.OLLAMA_REQUEST_TIMEOUT_MS);

    try {
      const requestBody = JSON.stringify({
        model: env.CONFLICT_EMBEDDING_MODEL,
        input: texts,
        keep_alive: "10m"
      });
      const response = await fetch(ollamaApiUrl("/api/embed"), {
        method: "POST",
        headers: ollamaRequestHeaders(),
        signal: controller.signal,
        body: requestBody
      });

      if (response.status === 404) {
        const legacyEmbeddings = await Promise.all(
          texts.map(async (text) => {
            const legacyResponse = await fetch(ollamaApiUrl("/api/embeddings"), {
              method: "POST",
              headers: ollamaRequestHeaders(),
              signal: controller.signal,
              body: JSON.stringify({ model: env.CONFLICT_EMBEDDING_MODEL, prompt: text })
            });

            if (!legacyResponse.ok) {
              const body = (await legacyResponse.text().catch(() => "")).trim().slice(0, 400);
              throw new Error(`Ollama embedding failed with HTTP ${legacyResponse.status}${body ? `: ${body}` : ""}`);
            }

            const payload = (await legacyResponse.json()) as { embedding?: unknown };
            if (!Array.isArray(payload.embedding)) {
              throw new Error("Ollama legacy embedding response did not include an embedding");
            }

            const vector = payload.embedding.map(Number);
            assertVector(vector);
            return vector;
          })
        );
        return legacyEmbeddings;
      }

      if (!response.ok) {
        const body = (await response.text().catch(() => "")).trim().slice(0, 400);
        throw new Error(`Ollama embedding failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
      }

      const payload = (await response.json()) as { embeddings?: unknown; embedding?: unknown };
      const rawEmbeddings = Array.isArray(payload.embeddings)
        ? payload.embeddings
        : payload.embedding
          ? [payload.embedding]
          : [];
      if (!rawEmbeddings.length) {
        throw new Error("Ollama embedding response did not include embeddings");
      }

      const embeddings = rawEmbeddings.map((embedding) => {
        if (!Array.isArray(embedding)) {
          throw new Error("Ollama returned an invalid embedding");
        }

        const vector = embedding.map(Number);
        assertVector(vector);
        return vector;
      });

      if (embeddings.length !== texts.length) {
        throw new Error("Ollama returned a different number of embeddings than requested");
      }

      return embeddings;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function vectorLiteral(vector: number[]) {
  assertVector(vector);
  return `[${vector.join(",")}]`;
}

async function saveDecisionEmbedding(decisionId: string, text: string, vector: number[]) {
  const id = randomUUID();
  const textHash = contentHash(text);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "decision_embeddings" ("id", "decisionId", "model", "dimensions", "textHash", "embedding", "createdAt", "updatedAt")
    VALUES (${id}, ${decisionId}, ${env.CONFLICT_EMBEDDING_MODEL}, ${env.CONFLICT_EMBEDDING_DIMENSIONS}, ${textHash}, ${vectorLiteral(vector)}::vector, NOW(), NOW())
    ON CONFLICT ("decisionId", "model", "textHash")
    DO UPDATE SET "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()
  `);
}

export async function rankCandidatesByEmbedding(
  context: ConflictPullRequestContext,
  candidates: ConflictCandidate[],
  provider: EmbeddingProvider = new OllamaEmbeddingProvider()
) {
  if (!candidates.length) {
    return [];
  }

  const sourceText = buildConflictPrText(context);
  const sourceEmbedding = await provider.embed(sourceText);
  const candidateTexts = candidates.map((candidate) => buildDecisionText(candidate));
  const existing = await prisma.decisionEmbedding.findMany({
    where: {
      model: env.CONFLICT_EMBEDDING_MODEL,
      OR: candidates.map((candidate, index) => ({
        decisionId: candidate.id,
        textHash: contentHash(candidateTexts[index] ?? "")
      }))
    },
    select: { decisionId: true, textHash: true }
  });
  const existingKeys = new Set(existing.map((record) => `${record.decisionId}:${record.textHash}`));
  const missingIndexes = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => !existingKeys.has(`${candidate.id}:${contentHash(candidateTexts[index] ?? "")}`));

  if (missingIndexes.length) {
    const vectors = await provider.embedMany(missingIndexes.map(({ index }) => candidateTexts[index] ?? ""));
    await Promise.all(
      missingIndexes.map(({ candidate, index }, vectorIndex) =>
        saveDecisionEmbedding(candidate.id, candidateTexts[index] ?? "", vectors[vectorIndex] ?? [])
      )
    );
  }

  const ids = candidates.map((candidate) => candidate.id);
  const rows = await prisma.$queryRaw<Array<{ decisionId: string; similarity: number | string }>>(Prisma.sql`
    SELECT DISTINCT ON (e."decisionId")
      e."decisionId" AS "decisionId",
      1 - (e."embedding" <=> ${vectorLiteral(sourceEmbedding)}::vector) AS "similarity"
    FROM "decision_embeddings" e
    WHERE e."model" = ${env.CONFLICT_EMBEDDING_MODEL}
      AND e."decisionId" IN (${Prisma.join(ids)})
    ORDER BY e."decisionId", e."createdAt" DESC
  `);
  const scores = new Map(rows.map((row) => [row.decisionId, Number(row.similarity)]));

  return candidates
    .map((candidate) => ({
      ...candidate,
      similarityScore: scores.get(candidate.id) ?? 0,
      matchMethod: "HYBRID" as const
    }))
    .filter((candidate) => candidate.similarityScore >= env.CONFLICT_SIMILARITY_THRESHOLD)
    .sort((left, right) => right.similarityScore - left.similarityScore)
    .slice(0, env.CONFLICT_MAX_CANDIDATES);
}
