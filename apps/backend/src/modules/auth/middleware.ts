import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../middleware/error.js";
import { parseCookies, sessionCookieName } from "./cookies.js";
import { isAuthEnabled, userFromSessionToken } from "./service.js";
import type { RequestUser } from "./types.js";

export type AuthenticatedRequest = Request & {
  user?: RequestUser;
};

export async function attachCurrentUser(request: Request, _response: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    return next();
  }

  try {
    const cookies = parseCookies(request.header("cookie"));
    const user = await userFromSessionToken(cookies.get(sessionCookieName));
    (request as AuthenticatedRequest).user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireCurrentUser(request: Request) {
  const user = (request as AuthenticatedRequest).user;

  if (!user) {
    throw new HttpError(401, "GitHub sign-in is required");
  }

  return user;
}

export function requireDashboardUser(request: Request, _response: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    return next();
  }

  try {
    requireCurrentUser(request);
    return next();
  } catch (error) {
    return next(error);
  }
}
