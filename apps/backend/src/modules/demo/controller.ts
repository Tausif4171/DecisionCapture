import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { analyzeOrQueue } from "../queue/service.js";
import { sampleMergedPullRequest } from "./sample-pr.js";

export async function createDemoPr(_request: Request, response: Response) {
  if (!env.DEMO_MODE_ENABLED) {
    throw new HttpError(404, "Demo mode is disabled");
  }

  const result = await analyzeOrQueue(sampleMergedPullRequest());
  return response.status(result.status === "queued" ? 202 : 200).json(result);
}
