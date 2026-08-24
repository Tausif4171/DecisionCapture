import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireDashboardUser } from "../auth/middleware.js";
import {
  connectGitHub,
  getContext,
  getGitHubConnection,
  listGitHubIssues,
  listGitHubRepositories,
  resolveContextUrl
} from "./controller.js";

export const contextsRouter = Router();

contextsRouter.use(requireDashboardUser);
contextsRouter.get("/providers/github/connection", asyncHandler(getGitHubConnection));
contextsRouter.post("/providers/github/connect", asyncHandler(connectGitHub));
contextsRouter.get("/providers/github/repositories", asyncHandler(listGitHubRepositories));
contextsRouter.get("/providers/github/issues", asyncHandler(listGitHubIssues));
contextsRouter.post("/resolve-url", asyncHandler(resolveContextUrl));
contextsRouter.get("/:id", asyncHandler(getContext));
