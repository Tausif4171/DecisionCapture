import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { analyzeOrQueue } from "../queue/service.js";
import { enrichWebhookToPRContext, shouldProcessPullRequestWebhook } from "./service.js";
import { verifyGitHubSignature } from "./signature.js";
import { githubPullRequestWebhookSchema } from "./validation.js";

export async function githubWebhook(request: Request, response: Response) {
  const eventName = request.header("x-github-event");

  if (eventName !== "pull_request") {
    return response.status(202).json({
      status: "ignored",
      message: `Ignoring GitHub event ${eventName ?? "unknown"}`
    });
  }

  const payload = githubPullRequestWebhookSchema.parse(request.body);

  if (!shouldProcessPullRequestWebhook(payload)) {
    return response.status(202).json({
      status: "ignored",
      message: "Only merged pull_request.closed events are analyzed"
    });
  }

  const signature = request.header("x-hub-signature-256");
  const rawBody = request.rawBody ?? JSON.stringify(request.body);

  if (!env.GITHUB_WEBHOOK_SECRET) {
    throw new HttpError(503, "GitHub webhook secret is not configured");
  }

  if (!verifyGitHubSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET)) {
    throw new HttpError(401, "Invalid GitHub webhook signature");
  }

  const context = await enrichWebhookToPRContext(payload);
  const result = await analyzeOrQueue(context);
  return response.status(result.status === "queued" ? 202 : 200).json(result);
}
