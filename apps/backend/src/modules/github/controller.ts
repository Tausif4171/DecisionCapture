import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { analyzeOrQueue } from "../queue/service.js";
import { contextWebhookService } from "../contexts/webhook.service.js";
import {
  enrichWebhookToPRContext,
  shouldProcessConflictWebhook,
  shouldProcessPullRequestWebhook
} from "./service.js";
import { verifyGitHubSignature } from "./signature.js";
import { githubPullRequestWebhookSchema } from "./validation.js";
import { conflictService } from "../conflicts/service.js";

export async function githubWebhook(request: Request, response: Response) {
  const eventName = request.header("x-github-event");
  const signature = request.header("x-hub-signature-256");
  const rawBody = request.rawBody ?? JSON.stringify(request.body);

  if (!env.GITHUB_WEBHOOK_SECRET) {
    throw new HttpError(503, "GitHub webhook secret is not configured");
  }

  if (!verifyGitHubSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET)) {
    throw new HttpError(401, "Invalid GitHub webhook signature");
  }

  const pullRequestPayload =
    eventName === "pull_request" ? githubPullRequestWebhookSchema.parse(request.body) : null;
  const shouldCaptureMergedDecision = Boolean(
    pullRequestPayload && shouldProcessPullRequestWebhook(pullRequestPayload)
  );
  const shouldAnalyzeConflict = Boolean(
    pullRequestPayload && shouldProcessConflictWebhook(pullRequestPayload)
  );

  if (pullRequestPayload && !shouldCaptureMergedDecision && !shouldAnalyzeConflict) {
    return response.status(202).json({
      status: "ignored",
      message: "This pull_request event is outside the enabled DecisionCapture workflows"
    });
  }

  if (["issues", "issue_comment", "installation", "installation_repositories"].includes(eventName ?? "")) {
    const deliveryId = request.header("x-github-delivery");
    if (!deliveryId) {
      throw new HttpError(400, "GitHub webhook delivery id is required");
    }

    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw new HttpError(400, "GitHub webhook payload must be an object");
    }

    const result = await contextWebhookService.receive(eventName!, deliveryId, request.body);
    return response.status(202).json(result);
  }

  if (eventName !== "pull_request") {
    return response.status(202).json({
      status: "ignored",
      message: `Ignoring GitHub event ${eventName ?? "unknown"}`
    });
  }

  if (shouldAnalyzeConflict) {
    const deliveryId = request.header("x-github-delivery");
    if (!deliveryId) {
      throw new HttpError(400, "GitHub webhook delivery id is required");
    }

    const result = await conflictService.receiveWebhook(eventName, deliveryId, request.body);
    if (!shouldCaptureMergedDecision) {
      return response.status(result.status === "queued" ? 202 : 200).json(result);
    }
  }

  const context = await enrichWebhookToPRContext(pullRequestPayload!);
  const result = await analyzeOrQueue(context);
  return response.status(result.status === "queued" ? 202 : 200).json(result);
}
