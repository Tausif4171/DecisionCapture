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

const decisionRoutePaths = {
  analyze: "/analyze",
  list: "/",
  stats: "/stats",
  detail: "/:id",
  audit: "/:id/audit",
  approve: "/:id/approve",
  reject: "/:id/reject",
  reopen: "/:id/reopen"
} as const;

decisionsRouter.post(decisionRoutePaths.analyze, requireIngestToken, asyncHandler(analyzeDecision));
decisionsRouter.use(requireDashboardUser);
decisionsRouter.get(decisionRoutePaths.list, asyncHandler(listDecisions));
decisionsRouter.get(decisionRoutePaths.stats, asyncHandler(decisionStats));
decisionsRouter.get(decisionRoutePaths.detail, asyncHandler(getDecision));
decisionsRouter.get(decisionRoutePaths.audit, asyncHandler(listDecisionAuditLogs));
decisionsRouter.patch(decisionRoutePaths.detail, asyncHandler(updateDecision));
decisionsRouter.patch(decisionRoutePaths.approve, asyncHandler(approveDecision));
decisionsRouter.patch(decisionRoutePaths.reject, asyncHandler(rejectDecision));
decisionsRouter.patch(decisionRoutePaths.reopen, asyncHandler(reopenDecision));
