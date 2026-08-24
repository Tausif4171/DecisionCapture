import type { Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import type { AuthenticatedRequest } from "../auth/middleware.js";
import { isAuthEnabled } from "../auth/service.js";
import type { ReviewActor } from "../auth/types.js";
import { integrationManagerRoles } from "../auth/types.js";
import { githubContextService } from "./github-context.service.js";
import { contextService } from "./service.js";
import {
  createDecisionContextLinkSchema,
  listGitHubIssuesSchema,
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

function requireIntegrationManager(request: Request) {
  const actor = reviewActor(request);
  if (!actor.authRequired) {
    return actor;
  }

  if (!actor.user) {
    throw new HttpError(401, "GitHub sign-in is required");
  }

  if (!integrationManagerRoles.includes(actor.user.role)) {
    throw new HttpError(403, "Only administrators and maintainers can manage GitHub integrations");
  }

  return actor;
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

export async function refreshDecisionContext(request: Request, response: Response) {
  const result = await contextService.refreshDecisionContext(
    param(request, "id", "Decision id"),
    param(request, "contextId", "Context id"),
    reviewActor(request)
  );
  return response.status(202).json(result);
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

export async function getGitHubConnection(_request: Request, response: Response) {
  return response.json(await githubContextService.connectionStatus());
}

export async function connectGitHub(request: Request, response: Response) {
  return response.json(await githubContextService.connect(requireIntegrationManager(request)));
}

export async function listGitHubRepositories(request: Request, response: Response) {
  requireIntegrationManager(request);
  return response.json(await githubContextService.repositories());
}

export async function listGitHubIssues(request: Request, response: Response) {
  requireIntegrationManager(request);
  const input = listGitHubIssuesSchema.parse(request.query);
  return response.json(await githubContextService.issues(input.repository, input.query));
}
