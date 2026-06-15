import type { PRContext } from "@decisioncapture/shared";

export function sampleMergedPullRequest(): PRContext {
  return {
    prNumber: 123,
    title: "Add Redis queue for PR decision analysis",
    description:
      "Webhook requests were doing too much work synchronously. This adds BullMQ with Redis so merged PRs can be analyzed with retries and failure handling.",
    mergedAt: new Date().toISOString(),
    author: "maya.dev",
    url: "https://github.com/acme/platform/pull/123",
    repository: "acme/platform",
    filesChanged: [
      "apps/backend/src/modules/queue/queue.ts",
      "apps/backend/src/modules/decisions/service.ts",
      "apps/backend/package.json",
      "docker-compose.yml",
      "README.md"
    ],
    commits: [
      "Introduce BullMQ decision analysis worker",
      "Move PR extraction outside webhook request path",
      "Document Redis retry behavior"
    ],
    reviewers: ["alex.arch", "sam.infra"],
    reviewComments: [
      "This should keep GitHub webhooks fast and give us retries when Ollama is slow.",
      "Redis is already part of our local stack, so using BullMQ here is a reasonable tradeoff."
    ],
    approvals: ["alex.arch"],
    labels: ["architecture", "infrastructure"],
    diffSummary:
      "Adds a queue module, Redis configuration, a worker process, and decision service integration for merged pull request analysis."
  };
}
