import {
  createGitHubAppJwt,
  getGitHubApiToken,
  invalidateGitHubApiToken
} from "./auth.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

type GitHubRequestOptions = {
  installationId?: string;
  method?: string;
  body?: unknown;
  authenticateAsApp?: boolean;
  retryAuthentication?: boolean;
};

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter: string | null,
    public readonly rateLimitRemaining: string | null,
    public readonly rateLimitReset: string | null
  ) {
    super(message);
  }
}

function appendPagination(path: string, page: number, perPage: number) {
  const url = new URL(path, GITHUB_API_BASE_URL);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}`;
}

export async function githubRequest<T>(path: string, options: GitHubRequestOptions = {}) {
  if (!path.startsWith("/")) {
    throw new Error("GitHub API path must start with /");
  }

  const token = options.authenticateAsApp
    ? createGitHubAppJwt()
    : await getGitHubApiToken(options.installationId);

  if (!token) {
    throw new Error("GitHub API credentials are not configured");
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "DecisionCapture",
      "x-github-api-version": GITHUB_API_VERSION
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    if (
      response.status === 401 &&
      !options.authenticateAsApp &&
      options.retryAuthentication !== false
    ) {
      invalidateGitHubApiToken(options.installationId);
      return githubRequest<T>(path, { ...options, retryAuthentication: false });
    }

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new GitHubApiError(
      payload?.message ?? `GitHub API request failed for ${path}`,
      response.status,
      response.headers.get("retry-after"),
      response.headers.get("x-ratelimit-remaining"),
      response.headers.get("x-ratelimit-reset")
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function githubRequestPages<T>(
  path: string,
  options: GitHubRequestOptions & { maxPages?: number; perPage?: number } = {}
) {
  const records: T[] = [];
  const maxPages = options.maxPages ?? 10;
  const perPage = options.perPage ?? 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await githubRequest<T[]>(appendPagination(path, page, perPage), options);
    records.push(...batch);

    if (batch.length < perPage) {
      break;
    }
  }

  return records;
}
