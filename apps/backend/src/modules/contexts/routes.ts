import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireDashboardUser } from "../auth/middleware.js";
import {
  getContext,
  resolveContextUrl
} from "./controller.js";

export const contextsRouter = Router();

contextsRouter.use(requireDashboardUser);
contextsRouter.post("/resolve-url", asyncHandler(resolveContextUrl));
contextsRouter.get("/:id", asyncHandler(getContext));
