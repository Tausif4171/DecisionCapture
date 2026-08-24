import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  GITHUB_APP_INSTALLATION_ID: "1234"
}));
const authMock = vi.hoisted(() => ({
  hasGitHubAppCredentials: vi.fn()
}));
const providerMock = vi.hoisted(() => ({
  getGitHubInstallation: vi.fn(),
  listGitHubRepositories: vi.fn(),
  listGitHubIssues: vi.fn()
}));
const prismaMock = vi.hoisted(() => ({
  providerConnection: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  }
}));

vi.mock("../src/config/env.js", () => ({ env: envMock }));
vi.mock("../src/modules/github/auth.js", () => authMock);
vi.mock("../src/modules/contexts/providers/github.provider.js", () => providerMock);
vi.mock("../src/modules/database/prisma.js", () => ({ prisma: prismaMock }));

import { GitHubContextService } from "../src/modules/contexts/github-context.service.js";

describe("GitHubContextService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.hasGitHubAppCredentials.mockReturnValue(true);
    prismaMock.providerConnection.findUnique.mockResolvedValue(null);
    prismaMock.providerConnection.upsert.mockResolvedValue({ id: "connection-1" });
  });

  it("distinguishes configured credentials from an active connection", async () => {
    await expect(new GitHubContextService().connectionStatus()).resolves.toEqual({
      configured: true,
      connected: false,
      installationId: "1234",
      accountLogin: null,
      repositorySelection: null,
      status: null
    });
  });

  it("verifies and persists the configured GitHub App installation", async () => {
    providerMock.getGitHubInstallation.mockResolvedValue({
      id: 1234,
      account: { id: 42, login: "acme", type: "Organization" },
      repository_selection: "selected",
      permissions: { issues: "read", pull_requests: "write" }
    });
    prismaMock.providerConnection.findUnique.mockResolvedValue({
      status: "ACTIVE",
      scopes: ["issues:read"],
      metadata: {
        accountLogin: "acme",
        repositorySelection: "selected"
      }
    });

    const result = await new GitHubContextService().connect({
      authRequired: true,
      user: {
        id: "user-1",
        githubId: "42",
        login: "maya",
        name: null,
        avatarUrl: null,
        role: "ADMIN"
      }
    });

    expect(result.connected).toBe(true);
    expect(prismaMock.providerConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: "GITHUB",
          providerAccountId: "installation:1234",
          createdByUserId: "user-1"
        })
      })
    );
  });

  it("uses only an active connection to list issues", async () => {
    prismaMock.providerConnection.findUnique.mockResolvedValue({
      status: "ACTIVE",
      scopes: ["issues:read"],
      metadata: { accountLogin: "acme" }
    });
    providerMock.listGitHubIssues.mockResolvedValue([{ number: 91 }]);

    await expect(new GitHubContextService().issues("acme/api", "auth")).resolves.toEqual([
      { number: 91 }
    ]);
    expect(providerMock.listGitHubIssues).toHaveBeenCalledWith("acme/api", "auth", "1234");
  });

  it("rejects a connection that cannot read GitHub issues", async () => {
    providerMock.getGitHubInstallation.mockResolvedValue({
      id: 1234,
      account: { id: 42, login: "acme", type: "Organization" },
      repository_selection: "selected",
      permissions: { pull_requests: "write" }
    });

    await expect(
      new GitHubContextService().connect({ authRequired: false })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "GitHub App requires repository Issues read permission"
    });
    expect(prismaMock.providerConnection.upsert).not.toHaveBeenCalled();
  });
});
