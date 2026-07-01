import { describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://decision:decision@localhost:5432/decisioncapture?schema=public",
  REDIS_URL: "redis://localhost:6379",
  QUEUE_MODE: "inline",
  QUEUE_WORKER_ENABLED: false,
  FRONTEND_ORIGIN: "https://decision-capture.vercel.app/",
  APP_BASE_URL: "https://decision-capture.vercel.app/",
  AUTH_MODE: "disabled",
  AUTH_SESSION_SECRET: undefined,
  AUTH_ALLOWED_LOGINS: "",
  AUTH_ADMIN_LOGINS: "",
  AUTH_MAINTAINER_LOGINS: "",
  AUTH_REVIEWER_LOGINS: "",
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
  GITHUB_WEBHOOK_SECRET: undefined,
  GITHUB_API_TOKEN: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  INGEST_API_TOKEN: "test-token",
  AI_PROVIDER: "heuristic",
  OLLAMA_BASE_URL: "http://localhost:11434",
  OLLAMA_MODEL: "llama3.1",
  OLLAMA_REQUEST_TIMEOUT_MS: 120_000,
  USE_HEURISTIC_AI_FALLBACK: true,
  AUTO_APPROVAL_ENABLED: true,
  AUTO_APPROVE_CONFIDENCE: 0.85,
  DECISION_SCORE_THRESHOLD: 35
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock
}));

import { isAllowedCorsOrigin } from "../src/app.js";

describe("API CORS", () => {
  it("allows a configured frontend origin even when the env value has a trailing slash", async () => {
    expect(isAllowedCorsOrigin("https://decision-capture.vercel.app")).toBe(true);
    expect(isAllowedCorsOrigin("https://attacker.example")).toBe(false);
  });
});
