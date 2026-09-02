import type { PRContext } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/middleware/error.js";

const githubContextServiceMock = vi.hoisted(() => ({
  githubContextService: {
    activeInstallationId: vi.fn()
  }
}));

const contextServiceMock = vi.hoisted(() => ({
  contextService: {
    createDecisionContextLink: vi.fn()
  }
}));

const providerMock = vi.hoisted(() => ({
  fetchGitHubIssue: vi.fn()
}));

vi.mock("../src/modules/contexts/github-context.service.js", () => githubContextServiceMock);
vi.mock("../src/modules/contexts/service.js", () => contextServiceMock);
vi.mock("../src/modules/contexts/providers/github.provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/contexts/providers/github.provider.js")>()),
  ...providerMock
}));

import { autoLinkGitHubIssueReferences } from "../src/modules/contexts/auto-link.service.js";

function buildContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 21,
    title: "Use the new decision flow",
    description: "Decision: Use the new decision flow\nReason: Keep context attached to the change.\nFixes #91",
    mergedAt: "2026-06-16T06:30:00.000Z",
    author: "tausif4171",
    url: "https://github.com/acme/platform/pull/21",
    repository: "acme/platform",
    filesChanged: ["README.md"],
    commits: ["docs: explain decision flow"],
    reviewers: [],
    reviewComments: [],
    approvals: [],
    labels: [],
    diffSummary: "README update",
    ...overrides
  };
}

describe("autoLinkGitHubIssueReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    githubContextServiceMock.githubContextService.activeInstallationId.mockResolvedValue("installation-1");
    providerMock.fetchGitHubIssue.mockResolvedValue({
      title: "Centralize decision context",
      description: "Keep related context attached to the decision.",
      url: "https://github.com/acme/platform/issues/91",
      normalizedUrl: "https://github.com/acme/platform/issues/91",
      metadata: {
        owner: "acme",
        repo: "platform",
        issueNumber: 91
      }
    });
    contextServiceMock.contextService.createDecisionContextLink.mockResolvedValue({
      id: "link-91"
    });
  });

  it("validates and links an explicit GitHub issue reference", async () => {
    const result = await autoLinkGitHubIssueReferences("decision-21", buildContext());

    expect(result).toEqual({ linked: 1, skipped: 0 });
    expect(providerMock.fetchGitHubIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "GITHUB",
        type: "ISSUE",
        externalId: "issue:91"
      }),
      "installation-1"
    );
    expect(contextServiceMock.contextService.createDecisionContextLink).toHaveBeenCalledWith(
      "decision-21",
      {
        url: "https://github.com/acme/platform/issues/91",
        relationshipType: "RELATED",
        title: "Centralize decision context",
        description: "Keep related context attached to the decision."
      },
      { authRequired: false },
      {
        createdByLogin: "DecisionCapture",
        audit: {
          action: "CONTEXT_LINKED",
          note: "Automatically linked from merged PR #21."
        }
      }
    );
  });

  it("does not link anything when the PR has no explicit issue reference", async () => {
    const result = await autoLinkGitHubIssueReferences(
      "decision-21",
      buildContext({ description: "Decision: Keep the current behavior." })
    );

    expect(result).toEqual({ linked: 0, skipped: 0 });
    expect(githubContextServiceMock.githubContextService.activeInstallationId).not.toHaveBeenCalled();
    expect(providerMock.fetchGitHubIssue).not.toHaveBeenCalled();
    expect(contextServiceMock.contextService.createDecisionContextLink).not.toHaveBeenCalled();
  });

  it("fails soft when GitHub is not connected", async () => {
    githubContextServiceMock.githubContextService.activeInstallationId.mockRejectedValue(
      new HttpError(409, "Connect GitHub")
    );

    const result = await autoLinkGitHubIssueReferences("decision-21", buildContext());

    expect(result).toEqual({ linked: 0, skipped: 1 });
    expect(providerMock.fetchGitHubIssue).not.toHaveBeenCalled();
    expect(contextServiceMock.contextService.createDecisionContextLink).not.toHaveBeenCalled();
  });

  it("treats an already-linked issue as an idempotent retry", async () => {
    contextServiceMock.contextService.createDecisionContextLink.mockRejectedValue(
      new HttpError(409, "External context is already linked to this decision")
    );

    const result = await autoLinkGitHubIssueReferences("decision-21", buildContext());

    expect(result).toEqual({ linked: 0, skipped: 0 });
  });

  it("skips an issue that GitHub cannot validate without failing the decision", async () => {
    providerMock.fetchGitHubIssue.mockRejectedValue(new Error("Issue not found"));

    const result = await autoLinkGitHubIssueReferences("decision-21", buildContext());

    expect(result).toEqual({ linked: 0, skipped: 1 });
    expect(contextServiceMock.contextService.createDecisionContextLink).not.toHaveBeenCalled();
  });
});
