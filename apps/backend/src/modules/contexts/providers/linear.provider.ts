import type { ContextProviderAdapter } from "./types.js";

const LINEAR_ISSUE_ID_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export const linearContextProvider: ContextProviderAdapter = {
  provider: "LINEAR",
  resolveUrl(normalizedUrl) {
    const url = new URL(normalizedUrl);

    if (url.hostname !== "linear.app") {
      return null;
    }

    const [workspace, resourceType, issueId] = url.pathname.split("/").filter(Boolean);

    if (!workspace || resourceType !== "issue" || !issueId) {
      return null;
    }

    const normalizedIssueId = issueId.toUpperCase();

    if (!LINEAR_ISSUE_ID_PATTERN.test(normalizedIssueId)) {
      return null;
    }

    const canonicalUrl = `https://linear.app/${workspace}/issue/${normalizedIssueId}`;

    return {
      provider: "LINEAR",
      type: "ISSUE",
      providerAccountId: workspace.toLowerCase(),
      externalId: normalizedIssueId,
      url: canonicalUrl,
      normalizedUrl: canonicalUrl,
      title: normalizedIssueId,
      metadata: {
        workspace,
        issueId: normalizedIssueId
      }
    };
  }
};
