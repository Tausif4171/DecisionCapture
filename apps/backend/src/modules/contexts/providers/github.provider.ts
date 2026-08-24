import type {
  GitHubIssueCommentSnapshot,
  GitHubIssueContextMetadata,
  GitHubIssueSummary,
  GitHubRepositorySummary
} from "@decisioncapture/shared";
import { HttpError } from "../../../middleware/error.js";
import { githubRequest } from "../../github/client.js";
import type { ContextProviderAdapter, ContextProviderResolution } from "./types.js";

type GitHubInstallation = {
  id: number;
  account: {
    id: number;
    login?: string;
    slug?: string;
    type?: string;
  };
  repository_selection: string;
  permissions?: Record<string, string>;
};

type GitHubRepository = {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
};

type GitHubIssue = {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  html_url: string;
  repository_url?: string;
  comments: number;
  created_at: string;
  updated_at: string;
  user?: {
    login?: string | null;
    avatar_url?: string | null;
  } | null;
  labels: Array<string | { name?: string | null; color?: string | null }>;
  pull_request?: unknown;
};

type GitHubIssueComment = {
  id: number;
  body?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  user?: {
    login?: string | null;
  } | null;
};

export type GitHubIssueSnapshot = {
  title: string;
  description: string | null;
  url: string;
  normalizedUrl: string;
  metadata: GitHubIssueContextMetadata;
};

function githubIssueTitle(owner: string, repo: string, issueNumber: string) {
  return `${owner}/${repo}#${issueNumber}`;
}

export const githubContextProvider: ContextProviderAdapter = {
  provider: "GITHUB",
  resolveUrl(normalizedUrl) {
    const url = new URL(normalizedUrl);

    if (url.hostname !== "github.com") {
      return null;
    }

    const [owner, repo, resourceType, resourceId, ...rest] = url.pathname.split("/").filter(Boolean);

    if (!owner || !repo || resourceType !== "issues" || !resourceId || rest.length > 0) {
      return null;
    }

    if (!/^\d+$/.test(resourceId)) {
      return null;
    }

    const canonicalUrl = `https://github.com/${owner}/${repo}/issues/${resourceId}`;

    return {
      provider: "GITHUB",
      type: "ISSUE",
      providerAccountId: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
      externalId: `issue:${resourceId}`,
      url: canonicalUrl,
      normalizedUrl: canonicalUrl,
      title: githubIssueTitle(owner, repo, resourceId),
      metadata: {
        owner,
        repo,
        issueNumber: Number(resourceId)
      }
    };
  }
};

function repositoryParts(repository: string) {
  const [owner, repo, ...rest] = repository.split("/").filter(Boolean);
  if (!owner || !repo || rest.length > 0) {
    throw new HttpError(400, "GitHub repository must use the owner/repository format");
  }

  return {
    owner,
    repo,
    encodedOwner: encodeURIComponent(owner),
    encodedRepo: encodeURIComponent(repo)
  };
}

function issueLabels(issue: GitHubIssue) {
  return issue.labels
    .map((label) => (typeof label === "string" ? { name: label, color: null } : {
      name: label.name ?? "",
      color: label.color ?? null
    }))
    .filter((label) => label.name.length > 0);
}

function issueSummary(issue: GitHubIssue, repository: string): GitHubIssueSummary {
  return {
    id: issue.id,
    number: issue.number,
    repository,
    title: issue.title,
    state: issue.state === "closed" ? "closed" : "open",
    url: issue.html_url,
    authorLogin: issue.user?.login ?? null,
    labels: issueLabels(issue).map((label) => label.name),
    updatedAt: issue.updated_at
  };
}

function commentSnapshot(comment: GitHubIssueComment): GitHubIssueCommentSnapshot {
  return {
    id: comment.id,
    authorLogin: comment.user?.login ?? null,
    body: comment.body ?? "",
    url: comment.html_url,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at
  };
}

async function fetchRecentIssueComments(
  repository: string,
  issueNumber: number,
  commentCount: number,
  installationId: string
) {
  if (commentCount === 0) {
    return [];
  }

  const { encodedOwner, encodedRepo } = repositoryParts(repository);
  const lastPage = Math.max(1, Math.ceil(commentCount / 100));
  const pages = lastPage > 1 ? [lastPage - 1, lastPage] : [lastPage];
  const comments = await Promise.all(
    pages.map((page) =>
      githubRequest<GitHubIssueComment[]>(
        `/repos/${encodedOwner}/${encodedRepo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
        { installationId }
      )
    )
  );

  return comments.flat().slice(-100).map(commentSnapshot);
}

export async function getGitHubInstallation(installationId: string) {
  return githubRequest<GitHubInstallation>(`/app/installations/${installationId}`, {
    authenticateAsApp: true
  });
}

export async function listGitHubRepositories(installationId: string) {
  const repositories: GitHubRepository[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubRequest<{ repositories: GitHubRepository[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      { installationId }
    );
    repositories.push(...payload.repositories);

    if (payload.repositories.length < 100) {
      break;
    }
  }

  return repositories
    .map<GitHubRepositorySummary>((repository) => ({
      id: repository.id,
      fullName: repository.full_name,
      private: repository.private,
      url: repository.html_url
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function listGitHubIssues(
  repository: string,
  query: string,
  installationId: string
) {
  const { encodedOwner, encodedRepo } = repositoryParts(repository);
  const issues = await githubRequest<GitHubIssue[]>(
    `/repos/${encodedOwner}/${encodedRepo}/issues?state=all&sort=updated&direction=desc&per_page=100`,
    { installationId }
  );
  const normalizedQuery = query.trim().toLowerCase();

  return issues
    .filter((issue) => !issue.pull_request)
    .filter((issue) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        issue.title.toLowerCase().includes(normalizedQuery) ||
        String(issue.number) === normalizedQuery.replace(/^#/, "")
      );
    })
    .slice(0, 50)
    .map((issue) => issueSummary(issue, repository));
}

export async function fetchGitHubIssue(
  resolved: ContextProviderResolution,
  installationId: string
): Promise<GitHubIssueSnapshot> {
  const owner = typeof resolved.metadata?.owner === "string" ? resolved.metadata.owner : undefined;
  const repo = typeof resolved.metadata?.repo === "string" ? resolved.metadata.repo : undefined;
  const issueNumber = resolved.metadata?.issueNumber;

  if (!owner || !repo || typeof issueNumber !== "number") {
    throw new Error("GitHub context metadata is incomplete");
  }

  const repository = `${owner}/${repo}`;
  const { encodedOwner, encodedRepo } = repositoryParts(repository);
  const issue = await githubRequest<GitHubIssue>(
    `/repos/${encodedOwner}/${encodedRepo}/issues/${issueNumber}`,
    { installationId }
  );

  if (issue.pull_request) {
    throw new HttpError(400, "GitHub pull requests cannot be linked as issue context");
  }

  const recentComments = await fetchRecentIssueComments(
    issue.repository_url?.split("/repos/")[1] ?? repository,
    issue.number,
    issue.comments,
    installationId
  );
  const canonicalRepository = issue.repository_url?.split("/repos/")[1] ?? repository;
  const canonicalParts = repositoryParts(canonicalRepository);
  const canonicalUrl = `https://github.com/${canonicalParts.owner}/${canonicalParts.repo}/issues/${issue.number}`;

  return {
    title: issue.title,
    description: issue.body ?? null,
    url: canonicalUrl,
    normalizedUrl: canonicalUrl,
    metadata: {
      owner: canonicalParts.owner,
      repo: canonicalParts.repo,
      repository: canonicalRepository,
      issueNumber: issue.number,
      githubIssueId: issue.id,
      nodeId: issue.node_id,
      state: issue.state === "closed" ? "closed" : "open",
      stateReason: issue.state_reason ?? null,
      authorLogin: issue.user?.login ?? null,
      authorAvatarUrl: issue.user?.avatar_url ?? null,
      labels: issueLabels(issue),
      commentCount: issue.comments,
      recentComments,
      githubCreatedAt: issue.created_at,
      githubUpdatedAt: issue.updated_at
    }
  };
}
