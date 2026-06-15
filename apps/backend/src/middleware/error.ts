import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(new HttpError(404, `Route not found: ${request.method} ${request.path}`));
}

export function errorHandler(error: unknown, _request: Request, response: Response, next: NextFunction) {
  void next;

  if (error instanceof ZodError) {
    return response.status(400).json({
      error: "ValidationError",
      message: "Invalid request payload",
      issues: error.issues
    });
  }

  if (error instanceof HttpError) {
    return response.status(error.statusCode).json({
      error: "HttpError",
      message: error.message
    });
  }

  logger.error({ error }, "Unhandled request error");

  return response.status(500).json({
    error: "InternalServerError",
    message: "Something went wrong while processing the request"
  });
}
