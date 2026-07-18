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

const envSchema = z
  .object({
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
    AUTH_MODE: z.enum(["disabled", "github"]).default("disabled"),
    AUTH_SESSION_SECRET: optionalNonEmptyString,
    AUTH_ALLOWED_LOGINS: z.string().optional().default(""),
    AUTH_ADMIN_LOGINS: z.string().optional().default(""),
    AUTH_MAINTAINER_LOGINS: z.string().optional().default(""),
    AUTH_REVIEWER_LOGINS: z.string().optional().default(""),
    AUTH_GITHUB_PUBLIC_VIEWERS: booleanFromString,
    GITHUB_CLIENT_ID: optionalNonEmptyString,
    GITHUB_CLIENT_SECRET: optionalNonEmptyString,
    GITHUB_OAUTH_CALLBACK_URL: optionalNonEmptyString,
    GITHUB_WEBHOOK_SECRET: optionalNonEmptyString,
    GITHUB_API_TOKEN: optionalNonEmptyString,
    GITHUB_APP_ID: optionalNonEmptyString,
    GITHUB_APP_INSTALLATION_ID: optionalNonEmptyString,
    GITHUB_APP_PRIVATE_KEY: optionalNonEmptyString,
    INGEST_API_TOKEN: optionalNonEmptyString,
    AI_PROVIDER: z.enum(["ollama", "heuristic"]).default("ollama"),
    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
    OLLAMA_MODEL: z.string().default("llama3.1"),
    OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(120_000),
    USE_HEURISTIC_AI_FALLBACK: booleanFromString.default(true),
    AUTO_APPROVAL_ENABLED: booleanFromString.default(true),
    AUTO_APPROVE_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.78),
    DECISION_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(35)
  })
  .superRefine((values, context) => {
    if (values.AUTH_MODE !== "github") {
      return;
    }

    if (!values.GITHUB_CLIENT_ID) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_CLIENT_ID"],
        message: "GITHUB_CLIENT_ID is required when AUTH_MODE=github"
      });
    }

    if (!values.GITHUB_CLIENT_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_CLIENT_SECRET"],
        message: "GITHUB_CLIENT_SECRET is required when AUTH_MODE=github"
      });
    }

    if (!values.AUTH_SESSION_SECRET || values.AUTH_SESSION_SECRET.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_SESSION_SECRET"],
        message: "AUTH_SESSION_SECRET must be at least 32 characters when AUTH_MODE=github"
      });
    }

    const allowedLoginConfig = [
      values.AUTH_ALLOWED_LOGINS,
      values.AUTH_ADMIN_LOGINS,
      values.AUTH_MAINTAINER_LOGINS,
      values.AUTH_REVIEWER_LOGINS
    ].some((value) => value.split(",").some((login) => login.trim().length > 0));

    if (!allowedLoginConfig && !values.AUTH_GITHUB_PUBLIC_VIEWERS) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_ALLOWED_LOGINS"],
        message:
          "At least one allowed or role-assigned GitHub login is required when AUTH_MODE=github unless AUTH_GITHUB_PUBLIC_VIEWERS=true"
      });
    }
  })
  .superRefine((values, context) => {
    const githubAppValues = [
      values.GITHUB_APP_ID,
      values.GITHUB_APP_INSTALLATION_ID,
      values.GITHUB_APP_PRIVATE_KEY
    ];
    const configuredCount = githubAppValues.filter(Boolean).length;

    if (configuredCount > 0 && configuredCount < githubAppValues.length) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_APP_ID"],
        message:
          "GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY must be configured together"
      });
    }
  });

export const env = envSchema.parse(process.env);
