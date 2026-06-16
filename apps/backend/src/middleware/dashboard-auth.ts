import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export function requireDashboardToken(request: Request, response: Response, next: NextFunction) {
  if (!env.DASHBOARD_API_TOKEN) {
    return next();
  }

  const token = request.header("x-decisioncapture-dashboard-token");
  if (token !== env.DASHBOARD_API_TOKEN) {
    return response.status(401).json({
      error: "Unauthorized",
      message: "Invalid DecisionCapture dashboard token"
    });
  }

  return next();
}
