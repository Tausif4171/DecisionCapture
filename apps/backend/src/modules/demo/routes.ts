import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { createDemoPr } from "./controller.js";

export const demoRouter = Router();

demoRouter.post("/pr", asyncHandler(createDemoPr));
