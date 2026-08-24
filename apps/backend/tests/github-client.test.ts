import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  createGitHubAppJwt: vi.fn(),
  getGitHubApiToken: vi.fn(),
  invalidateGitHubApiToken: vi.fn()
}));

vi.mock("../src/modules/github/auth.js", () => authMock);

import { GitHubApiError, githubRequest } from "../src/modules/github/client.js";

describe("GitHub API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getGitHubApiToken.mockResolvedValue("installation-token");
  });

  it("invalidates and retries an installation token once after HTTP 401", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 91 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    await expect(
      githubRequest<{ id: number }>("/repos/acme/api/issues/91", {
        installationId: "1234"
      })
    ).resolves.toEqual({ id: 91 });
    expect(authMock.invalidateGitHubApiToken).toHaveBeenCalledWith("1234");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("exposes retry and rate-limit details without leaking credentials", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "retry-after": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1787420000"
        }
      })
    );

    const error = await githubRequest("/installation/repositories", {
      installationId: "1234"
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({
      status: 403,
      retryAfter: "60",
      rateLimitRemaining: "0",
      rateLimitReset: "1787420000"
    });
    expect(String(error)).not.toContain("installation-token");
  });
});
