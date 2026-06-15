import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export function requireIngestToken(request: Request, response: Response, next: NextFunction) {
  if (!env.INGEST_API_TOKEN) {
    return next();
  }

  const token = request.header("x-decisioncapture-token");
  if (token !== env.INGEST_API_TOKEN) {
    return response.status(401).json({
      error: "Unauthorized",
      message: "Invalid DecisionCapture ingest token"
    });
  }

  return next();
}
