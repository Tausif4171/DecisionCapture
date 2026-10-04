import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireDashboardUser } from "../auth/middleware.js";
import { getConflict, getConflictScan, listConflicts, reviewConflict } from "./controller.js";

export const conflictsRouter = Router();
export const conflictScansRouter = Router();

conflictsRouter.use(requireDashboardUser);
conflictsRouter.get("/", asyncHandler(listConflicts));
conflictsRouter.get("/:id", asyncHandler(getConflict));
conflictsRouter.patch("/:id", asyncHandler(reviewConflict));

conflictScansRouter.use(requireDashboardUser);
conflictScansRouter.get("/:id", asyncHandler(getConflictScan));
