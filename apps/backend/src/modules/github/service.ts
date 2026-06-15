import type { PRContext } from "@decisioncapture/shared";
import type { z } from "zod";
import type { githubPullRequestWebhookSchema } from "./validation.js";

type GitHubPullRequestWebhook = z.infer<typeof githubPullRequestWebhookSchema>;

export function shouldProcessPullRequestWebhook(payload: GitHubPullRequestWebhook) {
  return payload.action === "closed" && payload.pull_request.merged === true && payload.pull_request.draft !== true;
}

export function mapWebhookToPRContext(payload: GitHubPullRequestWebhook): PRContext {
  return {
    prNumber: payload.pull_request.number,
    title: payload.pull_request.title,
    description: payload.pull_request.body ?? "",
    mergedAt: payload.pull_request.merged_at ?? undefined,
    author: payload.pull_request.user.login,
    url: payload.pull_request.html_url,
    repository: payload.repository.full_name,
    filesChanged: [],
    commits: [],
    reviewers: [],
    reviewComments: [],
    approvals: [],
    labels: payload.pull_request.labels.map((label) => label.name),
    diffSummary:
      "GitHub webhook payload received. Configure the included GitHub Action for full files, commits, reviews, and diff context."
  };
}
