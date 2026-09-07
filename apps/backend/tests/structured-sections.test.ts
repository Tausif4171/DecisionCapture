import { describe, expect, it } from "vitest";
import { firstStructuredStatement, parseStructuredSections } from "../src/modules/decisions/structured-sections.js";

describe("structured PR sections", () => {
  it("stops a supported section at any following Markdown heading", () => {
    const sections = parseStructuredSections(`## Summary
Add the scoped relationship workflow.
Approved decisions can be compared with earlier decisions.

## Decision
- Keep relationship analysis separate from V1 capture.
- Treat AI output as a suggestion.

## Reason
This keeps failures isolated and lets reviewers control AI suggestions.

## Changes
- Add relationship persistence.
- Add a dedicated queue.

## Verification
- Backend tests passed.`);

    expect(sections.summary).toContain("Add the scoped relationship workflow.");
    expect(sections.reason).toBe("This keeps failures isolated and lets reviewers control AI suggestions.");
    expect(sections.reason).not.toContain("relationship persistence");
    expect(sections.reason).not.toContain("Backend tests passed");
  });

  it("supports inline Summary labels and concise multi-bullet titles", () => {
    const sections = parseStructuredSections(
      "Summary: Add concise decision titles. Decision: - Keep the title readable. - Preserve full provenance."
    );

    expect(firstStructuredStatement(sections.summary)).toBe("Add concise decision titles.");
  });
});
