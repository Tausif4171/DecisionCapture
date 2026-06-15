import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { githubWebhook } from "../src/modules/github/controller.js";
import { createGitHubSignature } from "../src/modules/github/signature.js";

type MockResponse = Response & {
  statusCodeValue: number;
  body: unknown;
};

function createMockResponse(): MockResponse {
  return {
    statusCodeValue: 200,
    body: undefined,
    status(code: number) {
      this.statusCodeValue = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  } as MockResponse;
}

function createMockRequest(body: unknown, headers: Record<string, string>): Request {
  const rawBody = JSON.stringify(body);
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    body,
    rawBody,
    header(name: string) {
      return normalizedHeaders.get(name.toLowerCase());
    }
  } as Request;
}

describe("GitHub webhook API", () => {
  it("ignores unmerged pull_request.closed events", async () => {
    const body = {
      action: "closed",
      repository: {
        full_name: "acme/platform"
      },
      pull_request: {
        number: 10,
        title: "Close without merge",
        body: "",
        merged: false,
        merged_at: null,
        html_url: "https://github.com/acme/platform/pull/10",
        draft: false,
        user: {
          login: "maya"
        },
        labels: []
      }
    };
    const rawBody = JSON.stringify(body);
    const response = createMockResponse();
    const request = createMockRequest(body, {
      "x-github-event": "pull_request",
      "x-hub-signature-256": createGitHubSignature(rawBody, "change-me")
    });

    await githubWebhook(request, response);

    expect(response.statusCodeValue).toBe(202);
    expect(response.body).toMatchObject({
      status: "ignored"
    });
  });
});
