import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { isAuthEnabled } from "../auth/service.js";
import type { ReviewActor } from "../auth/types.js";
import { contextService } from "./service.js";
import {
  createDecisionContextLinkSchema,
  resolveContextUrlSchema
} from "./validation.js";

function param(request: Request, name: string, label: string) {
  const value = request.params[name];

  if (!value || Array.isArray(value)) {
    throw new HttpError(400, `${label} is required`);
  }

  return value;
}

function reviewActor(request: Request): ReviewActor {
  return {
    user: (request as AuthenticatedRequest).user,
    authRequired: isAuthEnabled()
  };
}

export async function listDecisionContexts(request: Request, response: Response) {
  const result = await contextService.listDecisionContexts(param(request, "id", "Decision id"));
  return response.json(result);
}

export async function createDecisionContextLink(request: Request, response: Response) {
  const input = createDecisionContextLinkSchema.parse(request.body);
  const result = await contextService.createDecisionContextLink(
    param(request, "id", "Decision id"),
    input,
    reviewActor(request)
  );
  return response.status(201).json(result);
}

export async function deleteDecisionContextLink(request: Request, response: Response) {
  await contextService.deleteDecisionContextLink(
    param(request, "id", "Decision id"),
    param(request, "contextId", "Context id"),
    reviewActor(request)
  );
  return response.status(204).send();
}

export async function getContext(request: Request, response: Response) {
  const result = await contextService.getContext(param(request, "id", "Context id"));
  return response.json(result);
}

export async function resolveContextUrl(request: Request, response: Response) {
  const input = resolveContextUrlSchema.parse(request.body);
  const result = contextService.resolveUrl(input);
  return response.json(result);
}
