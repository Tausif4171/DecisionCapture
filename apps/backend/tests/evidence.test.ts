import type { PRContext } from "@decisioncapture/shared";
import { describe, expect, it } from "vitest";
import { assessExplanationEvidence } from "../src/modules/decisions/evidence.js";

function context(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 42,
    title: "Centralize admin route validation",
    description: "",
    author: "maya.dev",
    url: "https://github.com/acme/platform/pull/42",
    repository: "acme/platform",
    filesChanged: ["apps/backend/src/auth.ts"],
    commits: ["refactor: centralize admin route validation"],
    reviewers: [],
    reviewComments: [],
    approvals: [],
    labels: ["security"],
    diffSummary: "Large auth refactor",
    ...overrides
  };
}

describe("assessExplanationEvidence", () => {
  it("accepts explicit reasoning in the PR description", () => {
    expect(
      assessExplanationEvidence(
        context({
          description:
            "Decision: centralize admin validation. Reason: only admin routes need this check, so route-level validation keeps public routes simple."
        })
      )
    ).toEqual({
      hasExplicitReason: true,
      source: "DESCRIPTION"
    });
  });

  it("accepts substantive reasoning under a Markdown Reason heading", () => {
    expect(
      assessExplanationEvidence(
        context({
          description: `## Decision
Automatically link explicit GitHub issue references.

## Reason
The connected GitHub App and worker already process issue references, so users should not need to select the issue manually.

## Alternative
Require manual selection for every issue.`
        })
      )
    ).toEqual({
      hasExplicitReason: true,
      source: "DESCRIPTION"
    });
  });

  it("does not treat an unrelated Markdown heading as explanation evidence", () => {
    expect(
      assessExplanationEvidence(
        context({
          description:
            "## Notes\nThis is a long implementation note describing files, commands, and rollout details only."
        })
      )
    ).toEqual({
      hasExplicitReason: false,
      source: "MISSING"
    });
  });

  it("ignores Markdown headings inside fenced examples", () => {
    expect(
      assessExplanationEvidence(
        context({
          description: "```markdown\n## Reason\nThis is only an example and is not the PR rationale.\n```"
        })
      )
    ).toEqual({
      hasExplicitReason: false,
      source: "MISSING"
    });
  });

  it("accepts reasoning from review discussion when the description is empty", () => {
    expect(
      assessExplanationEvidence(
        context({
          reviewComments: [
            "Why not use global middleware?",
            "Because only admin routes need this validation, and middleware would affect every request."
          ]
        })
      )
    ).toEqual({
      hasExplicitReason: true,
      source: "DISCUSSION"
    });
  });

  it("does not treat large or important-looking changes as explanation", () => {
    expect(
      assessExplanationEvidence(
        context({
          title: "Rewrite authentication token handling",
          filesChanged: Array.from({ length: 25 }, (_, index) => `apps/auth/file-${index}.ts`),
          diffSummary: "Large auth diff touching login, refresh, and route validation."
        })
      )
    ).toEqual({
      hasExplicitReason: false,
      source: "MISSING"
    });
  });
});
