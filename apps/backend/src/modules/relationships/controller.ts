import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { isAuthEnabled } from "../auth/service.js";
import type { ReviewActor } from "../auth/types.js";
import { requestRelationshipAnalysis } from "./queue.js";
import { decisionRelationshipService } from "./service.js";
import { relationshipReviewSchema } from "./validation.js";

function routeParam(request: Request, name: "id" | "relationshipId") {
  const value = request.params[name];
  if (!value || Array.isArray(value)) {
    throw new HttpError(400, `${name === "id" ? "Decision" : "Relationship"} id is required`);
  }
  return value;
}

function relationshipActor(request: Request): ReviewActor {
  return {
    user: (request as AuthenticatedRequest).user,
    authRequired: isAuthEnabled()
  };
}

export async function getDecisionRelationships(request: Request, response: Response) {
  const result = await decisionRelationshipService.overview(
    routeParam(request, "id"),
    relationshipActor(request)
  );
  return response.json(result);
}

export async function analyzeDecisionRelationships(request: Request, response: Response) {
  const result = await requestRelationshipAnalysis({
    decisionId: routeParam(request, "id"),
    actor: relationshipActor(request)
  });
  return response.status(result.status === "completed" ? 200 : 202).json(result);
}

export async function acceptDecisionRelationship(request: Request, response: Response) {
  const input = relationshipReviewSchema.parse(request.body ?? {});
  const result = await decisionRelationshipService.accept(
    routeParam(request, "id"),
    routeParam(request, "relationshipId"),
    input.note,
    relationshipActor(request)
  );
  return response.json(result);
}

export async function dismissDecisionRelationship(request: Request, response: Response) {
  const input = relationshipReviewSchema.parse(request.body ?? {});
  const result = await decisionRelationshipService.dismiss(
    routeParam(request, "id"),
    routeParam(request, "relationshipId"),
    input.note,
    relationshipActor(request)
  );
  return response.json(result);
}
