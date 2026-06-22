import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireDashboardUser } from "../auth/middleware.js";
import { createDemoPr } from "./controller.js";

export const demoRouter = Router();

demoRouter.post("/pr", requireDashboardUser, asyncHandler(createDemoPr));
