import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireIngestToken } from "../../middleware/ingest-auth.js";
import { requireDashboardUser } from "../auth/middleware.js";
import {
  analyzeDecision,
  approveDecision,
  decisionStats,
  getDecision,
  listDecisionAuditLogs,
  listDecisions,
  reopenDecision,
  rejectDecision,
  updateDecision
} from "./controller.js";

export const decisionsRouter = Router();

decisionsRouter.post("/analyze", requireIngestToken, asyncHandler(analyzeDecision));
decisionsRouter.use(requireDashboardUser);
decisionsRouter.get("/", asyncHandler(listDecisions));
decisionsRouter.get("/stats", asyncHandler(decisionStats));
decisionsRouter.get("/:id", asyncHandler(getDecision));
decisionsRouter.get("/:id/audit", asyncHandler(listDecisionAuditLogs));
decisionsRouter.patch("/:id", asyncHandler(updateDecision));
decisionsRouter.patch("/:id/approve", asyncHandler(approveDecision));
decisionsRouter.patch("/:id/reject", asyncHandler(rejectDecision));
decisionsRouter.patch("/:id/reopen", asyncHandler(reopenDecision));
