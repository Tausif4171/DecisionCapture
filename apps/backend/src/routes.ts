import { Router } from "express";
import { env } from "./config/env.js";
import { asyncHandler } from "./middleware/async-handler.js";
import { authRouter } from "./modules/auth/routes.js";
import { decisionsRouter } from "./modules/decisions/routes.js";
import { demoRouter } from "./modules/demo/routes.js";
import { githubRouter } from "./modules/github/routes.js";
import { checkOllamaHealth } from "./modules/ai/ollama.provider.js";

export const router = Router();

router.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "decisioncapture-backend"
  });
});

router.get("/health/queue", (_request, response) => {
  response.json({
    status: "ok",
    queueMode: env.QUEUE_MODE,
    workerEnabled: env.QUEUE_MODE === "bullmq" && env.QUEUE_WORKER_ENABLED
  });
});

router.get(
  "/health/ai",
  asyncHandler(async (_request, response) => {
    response.json(await checkOllamaHealth());
  })
);

router.use("/auth", authRouter);
router.use("/github", githubRouter);
router.use("/decisions", decisionsRouter);
router.use("/demo", demoRouter);
