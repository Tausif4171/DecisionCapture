import type { ContextProviderAdapter } from "./types.js";

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
