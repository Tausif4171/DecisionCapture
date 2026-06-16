import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import { analyzeOrQueue } from "../queue/service.js";
import { decisionService } from "./service.js";
import { approveDecisionSchema, decisionSearchSchema, prContextSchema } from "./validation.js";

function decisionId(request: Request) {
  const id = request.params.id;

  if (!id || Array.isArray(id)) {
    throw new HttpError(400, "Decision id is required");
  }

  return id;
}

export async function analyzeDecision(request: Request, response: Response) {
  const context = prContextSchema.parse(request.body);
  const shouldWait = request.query.wait === "true";
  const result = shouldWait ? await decisionService.analyzePrContext(context) : await analyzeOrQueue(context);
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
  const decision = await decisionService.getDecision(decisionId(request));

  if (!decision) {
    throw new HttpError(404, "Decision not found");
  }

  return response.json(decision);
}

export async function approveDecision(request: Request, response: Response) {
  const updates = approveDecisionSchema.parse(request.body);
  const decision = await decisionService.approveDecision(decisionId(request), updates);
  return response.json(decision);
}

export async function rejectDecision(request: Request, response: Response) {
  const decision = await decisionService.rejectDecision(decisionId(request));
  return response.json(decision);
}
