import { describe, expect, it } from "vitest";
import { createGitHubSignature, verifyGitHubSignature } from "../src/modules/github/signature.js";

describe("GitHub webhook signatures", () => {
  it("accepts a valid sha256 signature", () => {
    const rawBody = JSON.stringify({ action: "closed" });
    const signature = createGitHubSignature(rawBody, "secret");

    expect(verifyGitHubSignature(rawBody, signature, "secret")).toBe(true);
  });

  it("rejects a mismatched signature", () => {
    const rawBody = JSON.stringify({ action: "closed" });
    const signature = createGitHubSignature(rawBody, "secret");

    expect(verifyGitHubSignature(rawBody, signature, "wrong")).toBe(false);
  });
});
