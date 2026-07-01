import cors from "cors";
import express, { type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { attachCurrentUser } from "./modules/auth/middleware.js";
import { router } from "./routes.js";

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

const allowedOrigins = new Set(
  env.FRONTEND_ORIGIN.split(",")
    .map(normalizeOrigin)
    .filter(Boolean)
);

export function isAllowedCorsOrigin(origin: string | undefined) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(normalizeOrigin(origin));
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedCorsOrigin(origin));
      },
      credentials: true
    })
  );
  app.use(
    express.json({
      limit: "2mb",
      verify: (request, _response, buffer) => {
        (request as Request).rawBody = buffer.toString("utf8");
      }
    })
  );
  app.use(pinoHttp({ logger }));
  app.use(attachCurrentUser);

  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
