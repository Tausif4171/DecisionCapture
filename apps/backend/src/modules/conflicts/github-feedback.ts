import type { DecisionConflict } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { githubRequest, githubRequestPages } from "../github/client.js";

const CHECK_NAME = "DecisionCapture: Potential conflict review";
const COMMENT_MARKER = "<!-- decisioncapture:conflict-comment -->";

type ConflictFeedbackRecord = Pick<DecisionConflict, "id" | "decisionId" | "repository" | "prNumber" | "prUrl" | "prTitle" | "similarityScore" | "confidence" | "explanation" | "evidence" | "status"> & {
  decision: {
    decision: string;
    reason: string;
    status: "APPROVED" | "REJECTED" | "PENDING";
  };
};

type FeedbackScan = {
  id: string;
  repository: string;
  prNumber: number;
  headSha: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  conflictCount: number;
  error?: string | null;
};

function repositoryPath(repository: string) {
  const [owner, name] = repository.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }

  return { owner, name };
}

function dashboardUrl(decisionId: string, conflictId?: string) {
  const base = (env.APP_BASE_URL ?? env.FRONTEND_ORIGIN.split(",")[0] ?? "").replace(/\/+$/, "");
  const path = `/decisions/${decisionId}`;
  return `${base}${conflictId ? `${path}?conflict=${encodeURIComponent(conflictId)}` : path}`;
}

function conflictSummary(conflict: ConflictFeedbackRecord) {
  return `Potential conflict with ${conflict.decision.status.toLowerCase()} decision "${conflict.decision.decision}". ${conflict.explanation}`;
}

function buildComment(scan: FeedbackScan, conflicts: ConflictFeedbackRecord[]) {
  const base = `${COMMENT_MARKER}\n\n## DecisionCapture conflict review\n\n`;

  if (scan.status === "PENDING" || scan.status === "RUNNING") {
    return `${base}Conflict analysis is ${scan.status === "PENDING" ? "queued" : "running"} for the current commit. This is advisory only; no merge is blocked.`;
  }

  if (scan.status === "FAILED") {
    return `${base}DecisionCapture could not complete conflict analysis for the current commit. This is advisory only; no merge is blocked.\n\nError: ${scan.error ?? "Unknown analysis error"}`;
  }

  if (!conflicts.length) {
    return `${base}No potential decision conflicts were found for the current commit. This result is advisory and does not guarantee that the PR is conflict-free.`;
  }

  const entries = conflicts
    .map((conflict) => {
      const evidence = conflict.evidence.map((item) => `- ${item}`).join("\n");
      return `### Potential conflict: ${conflict.decision.status.toLowerCase()} decision\n\n${conflictSummary(conflict)}\n\n- Confidence: ${Math.round(conflict.confidence * 100)}%\n- Similarity: ${Math.round(conflict.similarityScore * 100)}%\n- [Read the historical decision](${dashboardUrl(conflict.decisionId, conflict.id)})\n\nEvidence:\n${evidence}`;
    })
    .join("\n\n");

  return `${base}This PR may repeat or reverse an earlier engineering decision. Please review the evidence before merging.\n\n${entries}`;
}

export async function syncConflictFeedback(
  scan: FeedbackScan,
  conflicts: ConflictFeedbackRecord[]
) {
  const { owner, name } = repositoryPath(scan.repository);
  const repositoryPrefix = `/repos/${owner}/${name}`;
  const detailsUrl = conflicts[0] ? dashboardUrl(conflicts[0].decisionId, conflicts[0].id) : `${env.APP_BASE_URL ?? ""}/conflicts`;
  const title = scan.status === "PENDING"
    ? "Analysis queued"
    : scan.status === "RUNNING"
      ? "Analysis running"
      : scan.status === "FAILED"
        ? "Analysis unavailable"
        : conflicts.length
          ? `${conflicts.length} potential conflict${conflicts.length === 1 ? "" : "s"} found`
          : "No potential conflicts found";
  const summary = scan.status === "PENDING" || scan.status === "RUNNING"
    ? `DecisionCapture conflict analysis is ${scan.status === "PENDING" ? "queued" : "running"} for this commit. The merge remains unblocked.`
    : scan.status === "FAILED"
      ? "DecisionCapture could not analyze this PR. The merge remains unblocked."
      : conflicts.length
        ? conflicts.map(conflictSummary).join("\n\n")
        : "No historical decision conflict passed the configured evidence and confidence thresholds.";

  if (env.CONFLICT_CHECK_ENABLED) {
    const checks = await githubRequest<{
      check_runs?: Array<{ id: number; name: string; head_sha: string }>;
    }>(
      `${repositoryPrefix}/commits/${scan.headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&per_page=100`
    );
    const existing = (checks.check_runs ?? []).find(
      (check) => check.name === CHECK_NAME && check.head_sha === scan.headSha
    );
    const body: Record<string, unknown> = {
      name: CHECK_NAME,
      head_sha: scan.headSha,
      status: scan.status === "PENDING" ? "queued" : scan.status === "RUNNING" ? "in_progress" : "completed",
      details_url: detailsUrl,
      output: {
        title,
        summary,
        text: conflicts.length ? conflicts.map((conflict) => `- ${conflict.decision.decision}`).join("\n") : undefined
      }
    };

    if (scan.status !== "PENDING" && scan.status !== "RUNNING") {
      body.conclusion = scan.status === "FAILED" || conflicts.length ? "neutral" : "success";
      body.completed_at = new Date().toISOString();
    }

    if (existing) {
      await githubRequest(`${repositoryPrefix}/check-runs/${existing.id}`, { method: "PATCH", body });
    } else {
      await githubRequest(`${repositoryPrefix}/check-runs`, {
        method: "POST",
        body
      });
    }
  }

  if (env.CONFLICT_COMMENT_ENABLED) {
    const comments = await githubRequestPages<{ id: number; body?: string | null }>(
      `${repositoryPrefix}/issues/${scan.prNumber}/comments`,
      { perPage: 100, maxPages: 10 }
    );
    const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    const body = buildComment(scan, conflicts);

    if (existing) {
      await githubRequest(`${repositoryPrefix}/issues/comments/${existing.id}`, {
        method: "PATCH",
        body: { body }
      });
    } else {
      await githubRequest(`${repositoryPrefix}/issues/${scan.prNumber}/comments`, {
        method: "POST",
        body: { body }
      });
    }
  }
}

export function logConflictFeedbackFailure(error: unknown, scan: FeedbackScan) {
  logger.error(
    { err: error, repository: scan.repository, prNumber: scan.prNumber, scanId: scan.id },
    "Conflict feedback synchronization failed"
  );
}
