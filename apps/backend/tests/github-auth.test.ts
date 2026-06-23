import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  GITHUB_API_TOKEN: undefined,
  GITHUB_APP_ID: "12345",
  GITHUB_APP_INSTALLATION_ID: "67890",
  GITHUB_APP_PRIVATE_KEY: "test-private-key"
}));

const signer = vi.hoisted(() => ({
  update: vi.fn(),
  end: vi.fn(),
  sign: vi.fn()
}));

vi.mock("../src/config/env.js", () => ({ env: envMock }));
vi.mock("node:crypto", () => ({
  createSign: vi.fn(() => signer)
}));

import { getGitHubApiToken, hasGitHubApiCredentials } from "../src/modules/github/auth.js";

describe("GitHub App authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signer.update.mockReturnValue(signer);
    signer.end.mockReturnValue(signer);
    signer.sign.mockReturnValue("signed-jwt");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "installation-token",
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
      })
    } as Response);
  });

  it("exchanges a signed app JWT for a short-lived installation token", async () => {
    expect(hasGitHubApiCredentials()).toBe(true);
    await expect(getGitHubApiToken()).resolves.toBe("installation-token");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/67890/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer .+\.signed-jwt$/)
        })
      })
    );
  });
});
