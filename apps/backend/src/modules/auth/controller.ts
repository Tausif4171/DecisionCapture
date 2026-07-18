import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../middleware/error.js";
import {
  clearCookie,
  oauthStateCookie,
  oauthStateCookieName,
  sessionCookie,
  sessionCookieName
} from "./cookies.js";
import {
  authStatus,
  exchangeGitHubCode,
  fetchGitHubOAuthUser,
  frontendOAuthErrorUrl,
  frontendRedirectUrl,
  githubAuthorizeUrl,
  isAuthEnabled,
  safeReturnTo,
  upsertGitHubUser
} from "./service.js";
import { createOAuthState, createSessionToken, verifyOAuthState } from "./token.js";
import type { AuthenticatedRequest } from "./middleware.js";

export async function currentUser(request: Request, response: Response) {
  return response.json(authStatus((request as AuthenticatedRequest).user));
}

export async function startGitHubLogin(request: Request, response: Response) {
  if (!isAuthEnabled()) {
    throw new HttpError(404, "GitHub authentication is not enabled");
  }

  const returnTo = safeReturnTo(typeof request.query.returnTo === "string" ? request.query.returnTo : undefined);
  const state = createOAuthState(returnTo);
  response.setHeader("set-cookie", oauthStateCookie(state));
  return response.redirect(githubAuthorizeUrl(state));
}

export async function githubCallback(request: Request, response: Response) {
  if (!isAuthEnabled()) {
    throw new HttpError(404, "GitHub authentication is not enabled");
  }

  const redirectToOAuthError = (reason: "account-not-allowed" | "invalid-state" | "oauth-failed", returnTo = "/") => {
    response.setHeader("set-cookie", clearCookie(oauthStateCookieName));
    return response.redirect(frontendOAuthErrorUrl(reason, returnTo));
  };

  const code = typeof request.query.code === "string" ? request.query.code : undefined;
  const state = typeof request.query.state === "string" ? request.query.state : undefined;

  if (!code || !state) {
    return redirectToOAuthError("invalid-state");
  }

  const verifiedState = verifyOAuthState(state);
  if (!verifiedState) {
    return redirectToOAuthError("invalid-state");
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const githubUser = await fetchGitHubOAuthUser(accessToken);
    const user = await upsertGitHubUser(githubUser);
    const sessionToken = createSessionToken(user.id);

    response.setHeader("set-cookie", [
      sessionCookie(sessionToken),
      clearCookie(oauthStateCookieName)
    ]);
    return response.redirect(frontendRedirectUrl(verifiedState.returnTo));
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 403) {
      return redirectToOAuthError("account-not-allowed", verifiedState.returnTo);
    }

    logger.warn({ error }, "GitHub OAuth callback failed");
    return redirectToOAuthError("oauth-failed", verifiedState.returnTo);
  }
}

export async function logout(_request: Request, response: Response) {
  response.setHeader("set-cookie", clearCookie(sessionCookieName));
  return response.status(204).send();
}
