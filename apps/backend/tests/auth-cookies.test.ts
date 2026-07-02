import { describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  NODE_ENV: "production"
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock
}));

import { oauthStateCookie, sessionCookie } from "../src/modules/auth/cookies.js";

describe("auth cookies", () => {
  it("uses cross-site-safe cookies in production for Vercel to Render auth", () => {
    expect(sessionCookie("session-token")).toContain("SameSite=None");
    expect(sessionCookie("session-token")).toContain("Secure");
    expect(oauthStateCookie("state-token")).toContain("SameSite=None");
    expect(oauthStateCookie("state-token")).toContain("Secure");
  });
});
