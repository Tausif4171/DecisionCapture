import cors from "cors";
import express, { type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { router } from "./routes.js";

const allowedOrigins = env.FRONTEND_ORIGIN.split(",").map((origin) => origin.trim());

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins,
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

  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
