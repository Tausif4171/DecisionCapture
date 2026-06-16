import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireDashboardToken } from "../../middleware/dashboard-auth.js";
import { requireIngestToken } from "../../middleware/ingest-auth.js";
import {
  analyzeDecision,
  approveDecision,
  decisionStats,
  getDecision,
  listDecisions,
  rejectDecision
} from "./controller.js";

export const decisionsRouter = Router();

decisionsRouter.post("/analyze", requireIngestToken, asyncHandler(analyzeDecision));
decisionsRouter.use(requireDashboardToken);
decisionsRouter.get("/", asyncHandler(listDecisions));
decisionsRouter.get("/stats", asyncHandler(decisionStats));
decisionsRouter.get("/:id", asyncHandler(getDecision));
decisionsRouter.patch("/:id/approve", asyncHandler(approveDecision));
decisionsRouter.patch("/:id/reject", asyncHandler(rejectDecision));
