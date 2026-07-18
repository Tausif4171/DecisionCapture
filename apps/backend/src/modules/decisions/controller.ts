import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { isAuthEnabled } from "../auth/service.js";
import type { ReviewActor } from "../auth/types.js";
import { analyzeOrQueue } from "../queue/service.js";
import { processDecisionContext, syncDecisionNotificationFromStoredContext } from "./processor.js";
import { decisionService } from "./service.js";
import {
  decisionReopenSchema,
  decisionReviewSchema,
  decisionSearchSchema,
  prContextSchema
} from "./validation.js";

function decisionId(request: Request) {
  const id = request.params.id;

  if (!id || Array.isArray(id)) {
    throw new HttpError(400, "Decision id is required");
  }

  return id;
}

function reviewActor(request: Request): ReviewActor {
  return {
    user: (request as AuthenticatedRequest).user,
    authRequired: isAuthEnabled()
  };
}

export async function analyzeDecision(request: Request, response: Response) {
  const context = prContextSchema.parse(request.body);
  const shouldWait = request.query.wait === "true";
  const result = shouldWait ? await processDecisionContext(context) : await analyzeOrQueue(context);
  return response.status(result.status === "queued" ? 202 : 200).json(result);
}

export async function listDecisions(request: Request, response: Response) {
  const query = decisionSearchSchema.parse(request.query);
  const result = await decisionService.listDecisions(query);
  return response.json(result);
}

export async function decisionStats(_request: Request, response: Response) {
  const result = await decisionService.stats();
  return response.json(result);
}

export async function getDecision(request: Request, response: Response) {
  const decision = await decisionService.getDecision(decisionId(request), reviewActor(request));

  if (!decision) {
    throw new HttpError(404, "Decision not found");
  }

  return response.json(decision);
}

export async function listDecisionAuditLogs(request: Request, response: Response) {
  const auditLogs = await decisionService.listAuditLogs(decisionId(request));
  return response.json(auditLogs);
}

export async function updateDecision(request: Request, response: Response) {
  const updates = decisionReviewSchema.parse(request.body);
  const decision = await decisionService.updateDecision(decisionId(request), updates, reviewActor(request));
  await syncDecisionNotificationFromStoredContext(decision);
  return response.json(decision);
}

export async function approveDecision(request: Request, response: Response) {
  const updates = decisionReviewSchema.parse(request.body);
  const decision = await decisionService.approveDecision(decisionId(request), updates, reviewActor(request));
  await syncDecisionNotificationFromStoredContext(decision);
  return response.json(decision);
}

export async function rejectDecision(request: Request, response: Response) {
  const decision = await decisionService.rejectDecision(decisionId(request), reviewActor(request));
  await syncDecisionNotificationFromStoredContext(decision);
  return response.json(decision);
}

export async function reopenDecision(request: Request, response: Response) {
  const input = decisionReopenSchema.parse(request.body);
  const decision = await decisionService.reopenDecision(decisionId(request), input, reviewActor(request));
  await syncDecisionNotificationFromStoredContext(decision);
  return response.json(decision);
}
