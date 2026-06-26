import type { DecisionMemory } from "@decisioncapture/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  FRONTEND_ORIGIN: "http://localhost:3088",
  APP_BASE_URL: "http://localhost:3088",
  GITHUB_API_TOKEN: "github-token",
  GITHUB_APP_ID: undefined,
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined
}));

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock
}));

vi.mock("../src/config/logger.js", () => ({
  logger: loggerMock
}));

import { enrichWebhookToPRContext, syncDecisionReviewComment } from "../src/modules/github/service.js";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

function textResponse(body: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ body }),
    text: async () => body
  } as Response;
}

function buildPendingDecision(overrides: Partial<DecisionMemory> = {}): DecisionMemory {
  return {
    id: "decision-55",
    decision: "Use backend-owned PR review comments",
    reason: "Webhook and Action ingestion should notify authors the same way.",
    alternative: "Keep PR comments inside the GitHub Action only.",
    impact: "Pending review requests become consistent across ingestion paths.",
    author: "maya.dev",
    sourcePR: "PR #55",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/modules/github/service.ts"],
    confidence: 0.71,
    status: "PENDING",
    category: "architecture",
    extractionMethod: "OLLAMA",
    prRecordId: "pr-record-55",
    createdAt: "2026-06-16T06:30:00.000Z",
    updatedAt: "2026-06-16T06:30:00.000Z",
    ...overrides
  };
}

describe("GitHub service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("enriches webhook payloads with full GitHub API context", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          number: 55,
          title: "Use backend-owned PR review comments",
          body: "Decision: Sync comments from the backend",
          merged_at: "2026-06-16T06:30:00.000Z",
          html_url: "https://github.com/acme/platform/pull/55",
          user: { login: "maya.dev" },
          labels: [{ name: "architecture" }],
          requested_reviewers: [{ login: "lee.dev" }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            filename: "apps/backend/src/modules/github/service.ts",
            patch: "@@\n+syncDecisionReviewComment()"
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            commit: {
              message: "feat: sync PR review comments from backend\n\nmore detail"
            }
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            state: "APPROVED",
            body: "Backend-owned comments look good",
            user: { login: "lee.dev" }
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1001,
            body: "Please keep the inline review link stable",
            user: { login: "maya.dev" }
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1002,
            body: "Normal PR conversation context",
            user: { login: "maya.dev" }
          },
          {
            id: 1003,
            body: "<!-- decisioncapture:review-comment -->\nDecisionCapture review text",
            user: { login: "decisioncapture-bot[bot]", type: "Bot" }
          },
          {
            id: 1004,
            body: "Vercel deployment status",
            user: { login: "vercel[bot]", type: "Bot" }
          }
        ])
      )
      .mockResolvedValueOnce(
        textResponse(`diff --git a/apps/backend/src/modules/github/service.ts b/apps/backend/src/modules/github/service.ts
@@
+syncDecisionReviewComment()`)
      );

    const result = await enrichWebhookToPRContext({
      action: "closed",
      repository: {
        full_name: "acme/platform"
      },
      pull_request: {
        number: 55,
        title: "placeholder",
        body: "",
        merged: true,
        merged_at: "2026-06-16T06:30:00.000Z",
        html_url: "https://github.com/acme/platform/pull/55",
        draft: false,
        user: {
          login: "maya.dev"
        },
        labels: []
      }
    });

    expect(result).toMatchObject({
      prNumber: 55,
      title: "Use backend-owned PR review comments",
      repository: "acme/platform",
      filesChanged: ["apps/backend/src/modules/github/service.ts"],
      commits: ["feat: sync PR review comments from backend"],
      reviewers: ["lee.dev"],
      approvals: ["lee.dev"],
      labels: ["architecture"]
    });
    expect(result.reviewComments).toEqual([
      "Backend-owned comments look good",
      "Please keep the inline review link stable",
      "Normal PR conversation context"
    ]);
    expect(result.diffSummary).toContain("diff --git");
  });

  it("updates the existing PR review comment when a decision already has a marker comment", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 9001,
            body: "<!-- decisioncapture:review-comment -->\nold body"
          }
        ])
      )
      .mockResolvedValueOnce(jsonResponse({ id: 9001 }));

    await syncDecisionReviewComment({
      context: {
        prNumber: 55,
        title: "Use backend-owned PR review comments",
        description: "",
        author: "maya.dev",
        url: "https://github.com/acme/platform/pull/55",
        repository: "acme/platform",
        filesChanged: []
      },
      decision: buildPendingDecision({
        status: "APPROVED"
      })
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toContain("/issues/comments/9001");
    expect(vi.mocked(global.fetch).mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH"
    });
  });

  it("tags the PR author when creating a pending review request", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 9002 }));

    await syncDecisionReviewComment({
      context: {
        prNumber: 55,
        title: "Use backend-owned PR review comments",
        description: "",
        author: "maya.dev",
        url: "https://github.com/acme/platform/pull/55",
        repository: "acme/platform",
        filesChanged: []
      },
      decision: buildPendingDecision()
    });

    const request = vi.mocked(global.fetch).mock.calls[1]?.[1];
    const body = JSON.parse(String(request?.body)) as { body: string };

    expect(body.body).toContain("@maya.dev");
    expect(body.body).toContain("approve, edit, or reject");
    expect(body.body).toContain("low-confidence architecture decision");
  });

  it("explains reopened review requests without calling them low confidence", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 9003 }));

    await syncDecisionReviewComment({
      context: {
        prNumber: 56,
        title: "Use single-flight token refresh policy",
        description: "",
        author: "maya.dev",
        url: "https://github.com/acme/platform/pull/56",
        repository: "acme/platform",
        filesChanged: []
      },
      decision: buildPendingDecision({
        decision: "Use single-flight token refresh policy",
        confidence: 1,
        reviewReason: "REVIEW_REOPENED"
      })
    });

    const request = vi.mocked(global.fetch).mock.calls[1]?.[1];
    const body = JSON.parse(String(request?.body)) as { body: string };

    expect(body.body).toContain("reopened this captured decision for another review");
    expect(body.body).toContain("confirm, edit, or reject");
    expect(body.body).not.toContain("low-confidence");
  });
});
