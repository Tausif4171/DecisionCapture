import { logger } from "../../config/logger.js";
import { HttpError } from "../../middleware/error.js";
import type { PRContext } from "@decisioncapture/shared";
import { githubContextService } from "./github-context.service.js";
import { contextService } from "./service.js";
import { fetchGitHubIssue } from "./providers/github.provider.js";
import { resolveExternalContextUrl } from "./providers/index.js";
import { extractGitHubIssueReferences } from "../github/issue-references.js";

function isDuplicateLink(error: unknown) {
  return error instanceof HttpError && error.statusCode === 409 && error.message.includes("already linked");
}

export async function autoLinkGitHubIssueReferences(decisionId: string, context: PRContext) {
  const references = extractGitHubIssueReferences(context.description ?? "", context.repository);
  if (references.length === 0) {
    return { linked: 0, skipped: 0 };
  }

  let installationId: string;
  try {
    installationId = await githubContextService.activeInstallationId();
  } catch (error) {
    logger.warn(
      { error, decisionId, references },
      "Explicit GitHub issue references were found, but GitHub is not connected"
    );
    return { linked: 0, skipped: references.length };
  }

  let linked = 0;
  let skipped = 0;

  for (const reference of references) {
    try {
      const resolved = resolveExternalContextUrl(reference, { type: "ISSUE" });
      const snapshot = await fetchGitHubIssue(resolved, installationId);

      await contextService.createDecisionContextLink(
        decisionId,
        {
          url: snapshot.normalizedUrl,
          relationshipType: "RELATED",
          title: snapshot.title,
          description: snapshot.description ?? undefined
        },
        { authRequired: false },
        {
          createdByLogin: "DecisionCapture",
          audit: {
            action: "CONTEXT_LINKED",
            note: `Automatically linked from merged PR #${context.prNumber}.`
          }
        }
      );
      linked += 1;
    } catch (error) {
      if (isDuplicateLink(error)) {
        logger.info({ decisionId, reference }, "GitHub issue reference is already linked");
        continue;
      }

      skipped += 1;
      logger.warn(
        { error, decisionId, reference },
        "Could not automatically link explicit GitHub issue reference"
      );
    }
  }

  return { linked, skipped };
}
