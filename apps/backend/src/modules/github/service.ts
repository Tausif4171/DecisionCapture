import type { DecisionMemory, PRContext } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { getGitHubApiToken, hasGitHubApiCredentials } from "./auth.js";
import type {
  DecisionReviewCommentInput,
  GitHubIssueComment,
  GitHubPullRequestCommit,
  GitHubPullRequestDetails,
  GitHubPullRequestFile,
  GitHubPullRequestReview,
  GitHubPullRequestWebhook,
  GitHubRepositoryRef
} from "./types.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_ACCEPT = "application/vnd.github+json";
const DIFF_ACCEPT = "application/vnd.github.v3.diff";
const REVIEW_COMMENT_MARKER = "<!-- decisioncapture:review-comment -->";
const MAX_DIFF_LINES = 220;

function firstDashboardOrigin() {
  return env.FRONTEND_ORIGIN.split(",")[0]?.trim() ?? "";
}

function dashboardBaseUrl() {
  return (env.APP_BASE_URL ?? firstDashboardOrigin()).replace(/\/+$/, "");
}

function parseRepository(fullName: string): GitHubRepositoryRef {
  const [owner, repo] = fullName.split("/");

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository name: ${fullName}`);
  }

  return {
    owner,
    repo,
    fullName
  };
}

function dedupe(values: Array<string | undefined | null>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ];
}

function summarizeDiff(diffText: string) {
  return diffText
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("diff --git") ||
        line.startsWith("@@") ||
        line.startsWith("+") ||
        line.startsWith("-")
    )
    .slice(0, MAX_DIFF_LINES)
    .join("\n");
}

function summarizeFilePatches(files: GitHubPullRequestFile[]) {
  const fallbackDiff = files
    .map((file) => {
      const patch = file.patch?.trim();
      return patch ? `diff --git a/${file.filename} b/${file.filename}\n${patch}` : "";
    })
    .filter(Boolean)
    .join("\n");

  return summarizeDiff(fallbackDiff);
}

function splitCommitHeadline(message: string) {
  return message.split("\n")[0]?.trim() ?? message.trim();
}

function isAutomatedComment(comment: GitHubIssueComment) {
  const login = comment.user?.login?.toLowerCase() ?? "";
  return (
    comment.body?.includes(REVIEW_COMMENT_MARKER) ||
    comment.user?.type === "Bot" ||
    login.endsWith("[bot]")
  );
}

function decisionUrl(decision: DecisionMemory) {
  const baseUrl = dashboardBaseUrl();
  return baseUrl ? `${baseUrl}/decisions/${decision.id}` : decision.id;
}

function buildDecisionReviewComment(context: PRContext, decision: DecisionMemory) {
  const url = decisionUrl(decision);
  const authorMention = context.author ? `@${context.author}` : "PR author";
  const pendingReason =
    decision.reviewReason === "MISSING_EXPLANATION"
      ? "DecisionCapture found a meaningful technical change, but the PR context does not clearly explain why this approach was chosen."
      : decision.reviewReason === "STRUCTURED_FALLBACK"
        ? "DecisionCapture used the structured fallback extractor and needs a human check before saving this memory."
        : `DecisionCapture found a low-confidence ${decision.category} decision in this merged PR.`;
  const pendingAsk =
    decision.reviewReason === "MISSING_EXPLANATION"
      ? "can you add the missing rationale and approve, edit, or reject this captured memory?"
      : "can you review the captured context and approve, edit, or reject it?";

  if (decision.status === "APPROVED") {
    return `${REVIEW_COMMENT_MARKER}

DecisionCapture review complete.

Decision: ${decision.decision}
Status: approved
${decision.approvedByLogin ? `Approved by: @${decision.approvedByLogin}\n` : ""}Record: ${url}`;
  }

  if (decision.status === "REJECTED") {
    return `${REVIEW_COMMENT_MARKER}

DecisionCapture review complete.

Decision: ${decision.decision}
Status: rejected
${decision.rejectedByLogin ? `Rejected by: @${decision.rejectedByLogin}\n` : ""}Record: ${url}`;
  }

  return `${REVIEW_COMMENT_MARKER}

${pendingReason}

${authorMention}, ${pendingAsk}

Decision: ${decision.decision}
Reason: ${decision.reason}
Status: pending
Review: ${url}`;
}

function appendPagination(path: string, page: number) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}per_page=100&page=${page}`;
}

async function fetchGitHub<T>(path: string, init?: RequestInit, accept = GITHUB_API_ACCEPT) {
  const token = await getGitHubApiToken();

  if (!token) {
    throw new Error("GitHub API credentials are not configured");
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "DecisionCapture",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${path} with HTTP ${response.status}`);
  }

  if (accept === DIFF_ACCEPT) {
    return (await response.text()) as T;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function fetchGitHubPages<T>(path: string) {
  const records: T[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchGitHub<T[]>(appendPagination(path, page));
    records.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return records;
}

async function fetchPullRequestDiff(repository: GitHubRepositoryRef, prNumber: number) {
  const path = `/repos/${repository.owner}/${repository.repo}/pulls/${prNumber}`;
  return fetchGitHub<string>(path, undefined, DIFF_ACCEPT);
}

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

export async function enrichWebhookToPRContext(payload: GitHubPullRequestWebhook): Promise<PRContext> {
  const context = mapWebhookToPRContext(payload);

  if (!hasGitHubApiCredentials()) {
    logger.warn(
      { repository: context.repository, prNumber: context.prNumber },
      "GitHub API credentials are not configured; processing webhook with partial PR context"
    );
    return context;
  }

  const repository = parseRepository(context.repository);
  const path = `/repos/${repository.owner}/${repository.repo}/pulls/${context.prNumber}`;

  const [pullRequest, files, commits, reviews, reviewComments, conversationComments, diff] = await Promise.all([
    fetchGitHub<GitHubPullRequestDetails>(path),
    fetchGitHubPages<GitHubPullRequestFile>(`${path}/files`),
    fetchGitHubPages<GitHubPullRequestCommit>(`${path}/commits`),
    fetchGitHubPages<GitHubPullRequestReview>(`${path}/reviews`),
    fetchGitHubPages<GitHubIssueComment>(`${path}/comments`),
    fetchGitHubPages<GitHubIssueComment>(
      `/repos/${repository.owner}/${repository.repo}/issues/${context.prNumber}/comments`
    ),
    fetchPullRequestDiff(repository, context.prNumber)
  ]);

  return {
    prNumber: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.body ?? "",
    mergedAt: pullRequest.merged_at ?? undefined,
    author: pullRequest.user.login,
    url: pullRequest.html_url,
    repository: context.repository,
    filesChanged: dedupe(files.map((file) => file.filename)),
    commits: dedupe(commits.map((commit) => splitCommitHeadline(commit.commit.message))),
    reviewers: dedupe([
      ...(pullRequest.requested_reviewers?.map((reviewer) => reviewer.login) ?? []),
      ...reviews.map((review) => review.user?.login)
    ]),
    reviewComments: dedupe([
      ...reviews.map((review) => review.body),
      ...reviewComments.map((comment) => comment.body),
      ...conversationComments
        .filter((comment) => !isAutomatedComment(comment))
        .map((comment) => comment.body)
    ]),
    approvals: dedupe(
      reviews.filter((review) => review.state === "APPROVED").map((review) => review.user?.login)
    ),
    labels: dedupe(pullRequest.labels?.map((label) => label.name) ?? context.labels ?? []),
    diffSummary: summarizeDiff(diff) || summarizeFilePatches(files)
  };
}

export async function syncDecisionReviewComment({ context, decision }: DecisionReviewCommentInput) {
  if (!hasGitHubApiCredentials()) {
    logger.warn(
      { decisionId: decision.id, repository: context.repository, prNumber: context.prNumber },
      "Skipping PR review comment sync because GitHub API credentials are not configured"
    );
    return;
  }

  const repository = parseRepository(context.repository);
  const listPath = `/repos/${repository.owner}/${repository.repo}/issues/${context.prNumber}/comments`;
  const comments = await fetchGitHubPages<GitHubIssueComment>(listPath);
  const existing = comments.find((comment) => comment.body?.includes(REVIEW_COMMENT_MARKER));

  if (!existing && decision.status !== "PENDING") {
    return;
  }

  const body = buildDecisionReviewComment(context, decision);

  if (existing) {
    await fetchGitHub(`/repos/${repository.owner}/${repository.repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
    return;
  }

  await fetchGitHub(listPath, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}
