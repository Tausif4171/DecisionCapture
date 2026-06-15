import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { githubWebhook } from "./controller.js";

export const githubRouter = Router();

githubRouter.post("/webhook", asyncHandler(githubWebhook));
