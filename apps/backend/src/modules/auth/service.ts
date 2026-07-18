import type { AuthStatus, AuthUser } from "@decisioncapture/shared";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { prisma } from "../database/prisma.js";
import { verifySessionToken } from "./token.js";

type GitHubAccessTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GitHubOAuthUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
};

export type OAuthErrorReason = "account-not-allowed" | "invalid-state" | "oauth-failed";

function toAuthUser(user: {
  id: string;
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: AuthUser["role"];
}): AuthUser {
  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role
  };
}

function requireGitHubOAuthConfig() {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required when AUTH_MODE=github");
  }

  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET
  };
}

function configuredLogins(value: string) {
  return new Set(
    value
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/+$/, "");
}

function roleForLogin(login: string): AuthUser["role"] {
  const normalizedLogin = login.toLowerCase();

  if (configuredLogins(env.AUTH_ADMIN_LOGINS).has(normalizedLogin)) {
    return "ADMIN";
  }

  if (configuredLogins(env.AUTH_MAINTAINER_LOGINS).has(normalizedLogin)) {
    return "MAINTAINER";
  }

  if (configuredLogins(env.AUTH_REVIEWER_LOGINS).has(normalizedLogin)) {
    return "REVIEWER";
  }

  return "VIEWER";
}

function isLoginAllowed(login: string) {
  if (env.AUTH_GITHUB_PUBLIC_VIEWERS) {
    return true;
  }

  const normalizedLogin = login.toLowerCase();
  return [
    env.AUTH_ALLOWED_LOGINS,
    env.AUTH_ADMIN_LOGINS,
    env.AUTH_MAINTAINER_LOGINS,
    env.AUTH_REVIEWER_LOGINS
  ].some((value) => configuredLogins(value).has(normalizedLogin));
}

export function isAuthEnabled() {
  return env.AUTH_MODE === "github";
}

export function authStatus(user?: AuthUser): AuthStatus {
  return {
    authMode: env.AUTH_MODE,
    authenticated: Boolean(user),
    user
  };
}

export function githubAuthorizeUrl(state: string) {
  const { clientId } = requireGitHubOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "read:user",
    state
  });

  if (env.GITHUB_OAUTH_CALLBACK_URL) {
    params.set("redirect_uri", env.GITHUB_OAUTH_CALLBACK_URL);
  }

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function safeReturnTo(value: string | undefined) {
  if (!value) {
    return "/";
  }

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  const allowedOrigins = [
    ...env.FRONTEND_ORIGIN.split(",").map(normalizeOrigin),
    env.APP_BASE_URL
  ]
    .filter((origin): origin is string => Boolean(origin))
    .map(normalizeOrigin);

  try {
    const url = new URL(value);
    return allowedOrigins.includes(normalizeOrigin(url.origin)) ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

export function frontendRedirectUrl(returnTo: string) {
  const origin = normalizeOrigin(env.APP_BASE_URL ?? env.FRONTEND_ORIGIN.split(",")[0] ?? "http://localhost:3000");

  return `${origin}${safeReturnTo(returnTo)}`;
}

export function frontendOAuthErrorUrl(reason: OAuthErrorReason, returnTo = "/") {
  const url = new URL("/auth/error", frontendRedirectUrl("/"));
  url.searchParams.set("reason", reason);
  url.searchParams.set("returnTo", safeReturnTo(returnTo));
  return url.toString();
}

export async function exchangeGitHubCode(code: string) {
  const { clientId, clientSecret } = requireGitHubOAuthConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "DecisionCapture"
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth token exchange failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GitHubAccessTokenResponse;
  if (!payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub OAuth token exchange failed");
  }

  return payload.access_token;
}

export async function fetchGitHubOAuthUser(accessToken: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "DecisionCapture"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed with HTTP ${response.status}`);
  }

  return (await response.json()) as GitHubOAuthUser;
}

export async function upsertGitHubUser(githubUser: GitHubOAuthUser) {
  if (!isLoginAllowed(githubUser.login)) {
    throw new HttpError(403, "This GitHub account is not allowed to access DecisionCapture");
  }

  const role = roleForLogin(githubUser.login);
  const user = await prisma.appUser.upsert({
    where: { githubId: String(githubUser.id) },
    update: {
      login: githubUser.login,
      name: githubUser.name ?? null,
      avatarUrl: githubUser.avatar_url ?? null,
      role
    },
    create: {
      githubId: String(githubUser.id),
      login: githubUser.login,
      name: githubUser.name ?? null,
      avatarUrl: githubUser.avatar_url ?? null,
      role
    }
  });

  return toAuthUser(user);
}

export async function userFromSessionToken(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  const session = verifySessionToken(token);
  if (!session) {
    return undefined;
  }

  const user = await prisma.appUser.findUnique({ where: { id: session.userId } });
  if (!user || !isLoginAllowed(user.login)) {
    return undefined;
  }

  const role = roleForLogin(user.login);
  if (user.role === role) {
    return toAuthUser(user);
  }

  const updatedUser = await prisma.appUser.update({
    where: { id: user.id },
    data: { role }
  });
  return toAuthUser(updatedUser);
}
