import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  githubRequest: vi.fn()
}));

vi.mock("../src/modules/github/client.js", () => clientMock);

import {
  fetchGitHubIssue,
  listGitHubIssues,
  listGitHubRepositories
} from "../src/modules/contexts/providers/github.provider.js";

describe("GitHub context provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists repositories available to an installation", async () => {
    clientMock.githubRequest.mockResolvedValue({
      repositories: [
        {
          id: 2,
          full_name: "acme/web",
          private: false,
          html_url: "https://github.com/acme/web"
        },
        {
          id: 1,
          full_name: "acme/api",
          private: true,
          html_url: "https://github.com/acme/api"
        }
      ]
    });

    await expect(listGitHubRepositories("installation-1")).resolves.toEqual([
      {
        id: 1,
        fullName: "acme/api",
        private: true,
        url: "https://github.com/acme/api"
      },
      {
        id: 2,
        fullName: "acme/web",
        private: false,
        url: "https://github.com/acme/web"
      }
    ]);
  });

  it("filters pull requests out of issue selection", async () => {
    clientMock.githubRequest.mockResolvedValue([
      {
        id: 91,
        node_id: "issue-node-91",
        number: 91,
        title: "Centralize token refresh",
        state: "open",
        html_url: "https://github.com/acme/api/issues/91",
        comments: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
        user: { login: "maya" },
        labels: [{ name: "architecture", color: "00aa77" }]
      },
      {
        id: 92,
        node_id: "pull-node-92",
        number: 92,
        title: "Implementation PR",
        state: "open",
        html_url: "https://github.com/acme/api/pull/92",
        comments: 0,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
        user: { login: "maya" },
        labels: [],
        pull_request: {}
      }
    ]);

    const result = await listGitHubIssues("acme/api", "token", "installation-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 91,
      title: "Centralize token refresh",
      labels: ["architecture"]
    });
  });

  it("fetches and normalizes issue metadata with recent comments", async () => {
    clientMock.githubRequest
      .mockResolvedValueOnce({
        id: 91,
        node_id: "issue-node-91",
        number: 91,
        title: "Centralize token refresh",
        body: "Keep refresh behavior consistent.",
        state: "closed",
        state_reason: "completed",
        html_url: "https://github.com/acme/api/issues/91",
        repository_url: "https://api.github.com/repos/acme/api",
        comments: 1,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
        user: { login: "maya", avatar_url: "https://avatars.example/maya" },
        labels: [{ name: "architecture", color: "00aa77" }]
      })
      .mockResolvedValueOnce([
        {
          id: 501,
          body: "Approved for implementation.",
          html_url: "https://github.com/acme/api/issues/91#issuecomment-501",
          created_at: "2026-06-02T00:00:00.000Z",
          updated_at: "2026-06-02T00:00:00.000Z",
          user: { login: "lee" }
        }
      ]);

    const result = await fetchGitHubIssue(
      {
        provider: "GITHUB",
        type: "ISSUE",
        providerAccountId: "acme/api",
        externalId: "issue:91",
        url: "https://github.com/acme/api/issues/91",
        normalizedUrl: "https://github.com/acme/api/issues/91",
        metadata: { owner: "acme", repo: "api", issueNumber: 91 }
      },
      "installation-1"
    );

    expect(result).toMatchObject({
      title: "Centralize token refresh",
      description: "Keep refresh behavior consistent.",
      metadata: {
        repository: "acme/api",
        issueNumber: 91,
        githubIssueId: 91,
        state: "closed",
        stateReason: "completed",
        commentCount: 1,
        recentComments: [
          {
            id: 501,
            authorLogin: "lee"
          }
        ]
      }
    });
  });
});
