import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { currentUser, githubCallback, logout, startGitHubLogin } from "./controller.js";

export const authRouter = Router();

authRouter.get("/me", asyncHandler(currentUser));
authRouter.get("/github", asyncHandler(startGitHubLogin));
authRouter.get("/github/callback", asyncHandler(githubCallback));
authRouter.post("/logout", asyncHandler(logout));
