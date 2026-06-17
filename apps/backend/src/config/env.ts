import "dotenv/config";
import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .default(false)
  .transform((value) => value === true || value === "true");

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .default("postgresql://decision:decision@localhost:5432/decisioncapture?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_MODE: z.enum(["inline", "bullmq"]).default("inline"),
  QUEUE_WORKER_ENABLED: booleanFromString,
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  APP_BASE_URL: optionalNonEmptyString,
  GITHUB_WEBHOOK_SECRET: z.string().min(1).default("change-me"),
  GITHUB_API_TOKEN: optionalNonEmptyString,
  INGEST_API_TOKEN: optionalNonEmptyString,
  AI_PROVIDER: z.enum(["ollama", "heuristic"]).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1"),
  USE_HEURISTIC_AI_FALLBACK: booleanFromString.default(true),
  AUTO_APPROVE_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.78),
  DECISION_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(35)
});

export const env = envSchema.parse(process.env);
