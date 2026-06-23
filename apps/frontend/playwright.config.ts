import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3098";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    viewport: {
      width: 1440,
      height: 960
    }
  }
});
