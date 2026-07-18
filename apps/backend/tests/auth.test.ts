import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  AUTH_MODE: "github",
  AUTH_SESSION_SECRET: "a-secure-test-session-secret-that-is-long-enough",
  AUTH_ALLOWED_LOGINS: "product-engineer",
  AUTH_ADMIN_LOGINS: "Tausif4171",
  AUTH_MAINTAINER_LOGINS: "platform-maintainer",
  AUTH_REVIEWER_LOGINS: "platform-reviewer",
  AUTH_GITHUB_PUBLIC_VIEWERS: false,
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  GITHUB_OAUTH_CALLBACK_URL: undefined as string | undefined,
  FRONTEND_ORIGIN: "http://localhost:3088/",
  APP_BASE_URL: "http://localhost:3088/"
}));

const prismaMock = vi.hoisted(() => ({
  appUser: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock("../src/config/env.js", () => ({
  env: envMock
}));

vi.mock("../src/modules/database/prisma.js", () => ({
  prisma: prismaMock
}));

import {
  frontendOAuthErrorUrl,
  githubAuthorizeUrl,
  safeReturnTo,
  upsertGitHubUser,
  userFromSessionToken
} from "../src/modules/auth/service.js";
import { requireCurrentUser } from "../src/modules/auth/middleware.js";
import { githubCallback } from "../src/modules/auth/controller.js";
import {
  createOAuthState,
  createSessionToken,
  verifyOAuthState,
  verifySessionToken
} from "../src/modules/auth/token.js";

type MockResponse = Response & {
  headers: Record<string, number | string | string[]>;
  redirectUrl?: string;
};

function createMockResponse(): MockResponse {
  return {
    headers: {},
    setHeader(name: string, value: number | string | string[]) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    redirect(url: string) {
      this.redirectUrl = url;
      return this;
    }
  } as MockResponse;
}

describe("GitHub dashboard auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.AUTH_GITHUB_PUBLIC_VIEWERS = false;
    envMock.GITHUB_OAUTH_CALLBACK_URL = undefined;
  });

  it("accepts signed sessions and rejects tampered tokens", () => {
    const token = createSessionToken("user-1");

    expect(verifySessionToken(token)).toMatchObject({ userId: "user-1" });
    expect(verifySessionToken(`${token}tampered`)).toBeNull();
  });

  it("accepts signed OAuth state without relying on transient browser cookies", () => {
    const state = createOAuthState("/pending");

    expect(verifyOAuthState(state)).toMatchObject({ returnTo: "/pending" });
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });

  it("only permits local paths or configured frontend origins as OAuth return targets", () => {
    expect(safeReturnTo("/pending?status=open")).toBe("/pending?status=open");
    expect(safeReturnTo("http://localhost:3088/decisions/123")).toBe("/decisions/123");
    expect(safeReturnTo("https://attacker.example/steal-session")).toBe("/");
  });

  it("builds frontend OAuth error redirects without trusting external return targets", () => {
    const url = new URL(frontendOAuthErrorUrl("account-not-allowed", "https://attacker.example/steal-session"));

    expect(url.origin).toBe("http://localhost:3088");
    expect(url.pathname).toBe("/auth/error");
    expect(url.searchParams.get("reason")).toBe("account-not-allowed");
    expect(url.searchParams.get("returnTo")).toBe("/");
  });

  it("can send GitHub OAuth through a frontend proxy callback", () => {
    envMock.GITHUB_OAUTH_CALLBACK_URL = "https://decision-capture.vercel.app/api/auth/github/callback";

    const url = new URL(githubAuthorizeUrl("signed-state"));

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://decision-capture.vercel.app/api/auth/github/callback"
    );
  });

  it("requires an authenticated GitHub user for protected dashboard requests", () => {
    expect(() => requireCurrentUser({} as Request)).toThrowError("GitHub sign-in is required");
  });

  it("assigns configured GitHub logins their RBAC role", async () => {
    prismaMock.appUser.upsert.mockResolvedValue({
      id: "user-1",
      githubId: "4171",
      login: "Tausif4171",
      name: "Tausif",
      avatarUrl: null,
      role: "ADMIN"
    });

    const user = await upsertGitHubUser({
      id: 4171,
      login: "Tausif4171",
      name: "Tausif",
      avatar_url: null
    });

    expect(prismaMock.appUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: "ADMIN" }),
        update: expect.objectContaining({ role: "ADMIN" })
      })
    );
    expect(user.role).toBe("ADMIN");
  });

  it("rejects GitHub accounts outside the configured access boundary", async () => {
    await expect(
      upsertGitHubUser({
        id: 999,
        login: "external-user",
        name: null,
        avatar_url: null
      })
    ).rejects.toMatchObject({
      statusCode: 403
    });

    expect(prismaMock.appUser.upsert).not.toHaveBeenCalled();
  });

  it("can allow unknown GitHub accounts as public viewers for demo deployments", async () => {
    envMock.AUTH_GITHUB_PUBLIC_VIEWERS = true;
    prismaMock.appUser.upsert.mockResolvedValue({
      id: "user-public",
      githubId: "999",
      login: "external-founder",
      name: null,
      avatarUrl: null,
      role: "VIEWER"
    });

    const user = await upsertGitHubUser({
      id: 999,
      login: "external-founder",
      name: null,
      avatar_url: null
    });

    expect(prismaMock.appUser.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: "VIEWER" }),
        update: expect.objectContaining({ role: "VIEWER" })
      })
    );
    expect(user.role).toBe("VIEWER");
  });

  it("redirects disallowed OAuth callback accounts to the frontend error page", async () => {
    const state = createOAuthState("/pending");
    const response = createMockResponse();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "github-access-token" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 999,
          login: "external-user",
          name: null,
          avatar_url: null
        })
      } as Response);

    await githubCallback({ query: { code: "oauth-code", state } } as unknown as Request, response);

    const redirectUrl = new URL(response.redirectUrl ?? "");
    expect(redirectUrl.origin).toBe("http://localhost:3088");
    expect(redirectUrl.pathname).toBe("/auth/error");
    expect(redirectUrl.searchParams.get("reason")).toBe("account-not-allowed");
    expect(redirectUrl.searchParams.get("returnTo")).toBe("/pending");
    expect(response.headers["set-cookie"]).toContain("decisioncapture_oauth_state=");
    expect(prismaMock.appUser.upsert).not.toHaveBeenCalled();
  });

  it("refreshes an existing session user's role from current RBAC configuration", async () => {
    const token = createSessionToken("user-1");
    prismaMock.appUser.findUnique.mockResolvedValue({
      id: "user-1",
      githubId: "4171",
      login: "Tausif4171",
      name: "Tausif",
      avatarUrl: null,
      role: "VIEWER"
    });
    prismaMock.appUser.update.mockResolvedValue({
      id: "user-1",
      githubId: "4171",
      login: "Tausif4171",
      name: "Tausif",
      avatarUrl: null,
      role: "ADMIN"
    });

    const user = await userFromSessionToken(token);

    expect(prismaMock.appUser.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { role: "ADMIN" }
    });
    expect(user?.role).toBe("ADMIN");
  });
});
