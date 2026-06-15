import { Router } from "express";
import { decisionsRouter } from "./modules/decisions/routes.js";
import { demoRouter } from "./modules/demo/routes.js";
import { githubRouter } from "./modules/github/routes.js";

export const router = Router();

router.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "decisioncapture-backend"
  });
});

router.use("/github", githubRouter);
router.use("/decisions", decisionsRouter);
router.use("/demo", demoRouter);
