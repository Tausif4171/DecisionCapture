import { env } from "../../config/env.js";
import { checkOllamaHealth } from "../ai/ollama.provider.js";
import { prisma } from "../database/prisma.js";

export async function checkConflictHealth() {
  let vectorExtensionReady = false;
  let vectorError: string | null = null;

  try {
    const result = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS ready
    `;
    vectorExtensionReady = Boolean(result[0]?.ready);
  } catch (error) {
    vectorError = error instanceof Error ? error.message : String(error);
  }

  const ai = env.CONFLICT_DETECTION_ENABLED ? await checkOllamaHealth() : null;
  const availableModels = ai && "models" in ai ? ai.models : [];
  const analyzerModelAvailable = Boolean(ai && "modelAvailable" in ai && ai.modelAvailable);
  const embeddingModelAvailable = Boolean(
    availableModels.some((model) =>
      model === env.CONFLICT_EMBEDDING_MODEL ||
      (!env.CONFLICT_EMBEDDING_MODEL.includes(":") && model === `${env.CONFLICT_EMBEDDING_MODEL}:latest`)
    )
  );

  return {
    status:
      env.CONFLICT_DETECTION_ENABLED &&
      (!vectorExtensionReady || ai?.reachable !== true || !analyzerModelAvailable || !embeddingModelAvailable)
        ? "degraded"
        : "ok",
    enabled: env.CONFLICT_DETECTION_ENABLED,
    shadowMode: env.CONFLICT_SHADOW_MODE,
    repositories: env.CONFLICT_DETECTION_REPOSITORIES,
    queue: {
      name: "conflict-detection",
      mode: env.QUEUE_MODE,
      workerEnabled: env.QUEUE_MODE === "bullmq" && env.QUEUE_WORKER_ENABLED,
      concurrency: env.CONFLICT_QUEUE_CONCURRENCY
    },
    embedding: {
      provider: env.CONFLICT_EMBEDDING_PROVIDER,
      model: env.CONFLICT_EMBEDDING_MODEL,
      dimensions: env.CONFLICT_EMBEDDING_DIMENSIONS,
      vectorExtensionReady,
      modelAvailable: embeddingModelAvailable,
      error: vectorError
    },
    feedback: {
      commentEnabled: env.CONFLICT_COMMENT_ENABLED,
      checkEnabled: env.CONFLICT_CHECK_ENABLED
    },
    analyzer: ai
      ? {
          provider: ai.provider,
          model: ai.model,
          reachable: ai.reachable,
          modelAvailable: "modelAvailable" in ai ? ai.modelAvailable : false
        }
      : null
  };
}
