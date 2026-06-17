import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

function readDecisionCaptureToken(request: Request) {
  const directToken = request.header("x-decisioncapture-token");
  if (directToken) {
    return directToken;
  }

  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

export function requireIngestToken(request: Request, response: Response, next: NextFunction) {
  if (!env.INGEST_API_TOKEN) {
    return next();
  }

  const token = readDecisionCaptureToken(request);
  if (token !== env.INGEST_API_TOKEN) {
    return response.status(401).json({
      error: "Unauthorized",
      message: "Invalid DecisionCapture ingest token"
    });
  }

  return next();
}