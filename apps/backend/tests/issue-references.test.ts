import { describe, expect, it } from "vitest";
import { extractGitHubIssueReferences } from "../src/modules/github/issue-references.js";

describe("extractGitHubIssueReferences", () => {
  it("extracts same-repository closing references", () => {
    expect(
      extractGitHubIssueReferences(
        "Fixes #21\nCloses #34\nResolves #55",
        "Tausif4171/DecisionCapture"
      )
    ).toEqual([
      "https://github.com/Tausif4171/DecisionCapture/issues/21",
      "https://github.com/Tausif4171/DecisionCapture/issues/34",
      "https://github.com/Tausif4171/DecisionCapture/issues/55"
    ]);
  });

  it("extracts full issue URLs and deduplicates references", () => {
    expect(
      extractGitHubIssueReferences(
        "Related: https://github.com/acme/platform/issues/91. Fixes #91",
        "acme/platform"
      )
    ).toEqual(["https://github.com/acme/platform/issues/91"]);
  });

  it("supports an explicit cross-repository closing reference", () => {
    expect(
      extractGitHubIssueReferences(
        "Resolves acme/platform#91",
        "acme/other-repository"
      )
    ).toEqual(["https://github.com/acme/platform/issues/91"]);
  });

  it("ignores bare issue numbers, pull requests, and code examples", () => {
    const body = [
      "Issue #21 is discussed here.",
      "https://github.com/acme/platform/pull/22",
      "",
      "```",
      "Fixes #23",
      "```",
      "",
      "`Closes #24`"
    ].join("\n");

    expect(
      extractGitHubIssueReferences(body, "acme/platform")
    ).toEqual([]);
  });

  it("returns full URL references even when the PR repository is malformed", () => {
    expect(
      extractGitHubIssueReferences(
        "See https://acme.example/issues/1 and https://github.com/acme/platform/issues/91",
        "malformed-repository"
      )
    ).toEqual(["https://github.com/acme/platform/issues/91"]);
  });
});
