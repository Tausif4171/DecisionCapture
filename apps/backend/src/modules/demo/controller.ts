import type { Request, Response } from "express";
import { analyzeOrQueue } from "../queue/service.js";
import { sampleMergedPullRequest } from "./sample-pr.js";

export async function createDemoPr(_request: Request, response: Response) {
  const result = await analyzeOrQueue(sampleMergedPullRequest());
  return response.status(result.status === "queued" ? 202 : 200).json(result);
}
