import type { ContextProviderAdapter } from "./types.js";

const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export const jiraContextProvider: ContextProviderAdapter = {
  provider: "JIRA",
  resolveUrl(normalizedUrl) {
    const url = new URL(normalizedUrl);
    const [resourceType, issueKey] = url.pathname.split("/").filter(Boolean);

    if (resourceType !== "browse" || !issueKey) {
      return null;
    }

    const normalizedIssueKey = issueKey.toUpperCase();

    if (!JIRA_ISSUE_KEY_PATTERN.test(normalizedIssueKey)) {
      return null;
    }

    const canonicalUrl = `${url.protocol}//${url.hostname}/browse/${normalizedIssueKey}`;

    return {
      provider: "JIRA",
      type: "ISSUE",
      providerAccountId: url.hostname,
      externalId: normalizedIssueKey,
      url: canonicalUrl,
      normalizedUrl: canonicalUrl,
      title: normalizedIssueKey,
      metadata: {
        site: url.hostname,
        issueKey: normalizedIssueKey
      }
    };
  }
};
