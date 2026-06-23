import type { DecisionMemory, PRContext } from "@decisioncapture/shared";
import type { z } from "zod";
import type { githubPullRequestWebhookSchema } from "./validation.js";

export type GitHubPullRequestWebhook = z.infer<typeof githubPullRequestWebhookSchema>;

export type GitHubUser = {
  login: string;
  type?: string;
};

export type GitHubLabel = {
  name: string;
};

export type GitHubRepositoryRef = {
  owner: string;
  repo: string;
  fullName: string;
};

export type GitHubPullRequestDetails = {
  number: number;
  title: string;
  body?: string | null;
  merged_at?: string | null;
  html_url: string;
  user: GitHubUser;
  labels?: GitHubLabel[];
  requested_reviewers?: GitHubUser[];
};

export type GitHubPullRequestFile = {
  filename: string;
  patch?: string | null;
};

export type GitHubPullRequestCommit = {
  commit: {
    message: string;
  };
};

export type GitHubPullRequestReview = {
  state: string;
  body?: string | null;
  user?: GitHubUser | null;
};

export type GitHubIssueComment = {
  id: number;
  body?: string | null;
  user?: GitHubUser | null;
};

export type DecisionReviewCommentInput = {
  context: PRContext;
  decision: DecisionMemory;
};
