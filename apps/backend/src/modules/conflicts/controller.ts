import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { isAuthEnabled } from "../auth/service.js";
import type { ReviewActor } from "../auth/types.js";
import { conflictReviewSchema } from "./validation.js";
import { conflictService } from "./service.js";

function param(request: Request, name: string) {
  const value = request.params[name];
  if (!value || Array.isArray(value)) {
    throw new HttpError(400, `${name} is required`);
  }
  return value;
}

function actor(request: Request): ReviewActor {
  return {
    user: (request as AuthenticatedRequest).user,
    authRequired: isAuthEnabled()
  };
}

export async function listConflicts(request: Request, response: Response) {
  const prNumber = request.query.prNumber ? Number(request.query.prNumber) : undefined;
  return response.json(
    await conflictService.list(actor(request), {
      repository: typeof request.query.repository === "string" ? request.query.repository : undefined,
      status: typeof request.query.status === "string" ? request.query.status : undefined,
      prNumber: Number.isInteger(prNumber) ? prNumber : undefined
    })
  );
}

export async function getConflict(request: Request, response: Response) {
  return response.json(await conflictService.get(param(request, "id")));
}

export async function getConflictScan(request: Request, response: Response) {
  return response.json(await conflictService.getScan(param(request, "id")));
}

export async function reviewConflict(request: Request, response: Response) {
  const input = conflictReviewSchema.parse(request.body ?? {});
  return response.json(await conflictService.review(param(request, "id"), input.action, input.note, actor(request)));
}

export async function getDecisionConflicts(request: Request, response: Response) {
  return response.json(await conflictService.overviewForDecision(param(request, "id"), actor(request)));
}
