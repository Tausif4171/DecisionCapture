const githubIssueUrlPattern =
  /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/issues\/(\d+)(?=$|[\s?#)/.,])/gi;

const closingReferencePattern =
  /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?)\s*:?\s+(?:(\b[A-Za-z0-9][A-Za-z0-9_.-]*\/\b[A-Za-z0-9][A-Za-z0-9_.-]*))?#(\d+)\b/gi;

function withoutCodeSpans(body: string) {
  return body
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`[^`\n]*`/g, "");
}

function issueUrl(owner: string, repository: string, issueNumber: string) {
  return `https://github.com/${owner}/${repository}/issues/${issueNumber}`;
}

function repositoryKey(owner: string, repository: string, issueNumber: string) {
  return `${owner.toLowerCase()}/${repository.toLowerCase()}#${issueNumber}`;
}

/**
 * Extracts references GitHub itself treats as explicit issue references.
 * Bare issue numbers are intentionally ignored because they are ambiguous.
 */
export function extractGitHubIssueReferences(body: string, sourceRepository: string) {
  const [sourceOwner, sourceRepo, ...extraRepositoryParts] = sourceRepository.split("/");
  const hasSourceRepository =
    Boolean(sourceOwner && sourceRepo && extraRepositoryParts.length === 0);
  const sanitizedBody = withoutCodeSpans(body);
  const references: string[] = [];
  const seen = new Set<string>();

  for (const match of sanitizedBody.matchAll(githubIssueUrlPattern)) {
    const [, owner, repository, issueNumber] = match;
    if (!owner || !repository || !issueNumber) {
      continue;
    }

    const key = repositoryKey(owner, repository, issueNumber);
    if (!seen.has(key)) {
      seen.add(key);
      references.push(issueUrl(owner, repository, issueNumber));
    }
  }

  if (!hasSourceRepository) {
    return references;
  }

  for (const match of sanitizedBody.matchAll(closingReferencePattern)) {
    const [, referencedRepository, issueNumber] = match;
    if (!issueNumber) {
      continue;
    }

    const [owner, repository] = referencedRepository?.split("/") ?? [sourceOwner, sourceRepo];
    if (!owner || !repository) {
      continue;
    }

    const key = repositoryKey(owner, repository, issueNumber);
    if (!seen.has(key)) {
      seen.add(key);
      references.push(issueUrl(owner, repository, issueNumber));
    }
  }

  return references;
}
