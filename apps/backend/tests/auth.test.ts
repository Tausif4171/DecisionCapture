import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  AUTH_MODE: "github",
  AUTH_SESSION_SECRET: "a-secure-test-session-secret-that-is-long-enough",
  AUTH_ALLOWED_LOGINS: "product-engineer",
  AUTH_ADMIN_LOGINS: "Tausif4171",
  AUTH_MAINTAINER_LOGINS: "platform-maintainer",
  AUTH_REVIEWER_LOGINS: "platform-reviewer",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  FRONTEND_ORIGIN: "http://localhost:3088",
  APP_BASE_URL: "http://localhost:3088"
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

import { safeReturnTo, upsertGitHubUser, userFromSessionToken } from "../src/modules/auth/service.js";
import { requireCurrentUser } from "../src/modules/auth/middleware.js";
import { createSessionToken, verifySessionToken } from "../src/modules/auth/token.js";

describe("GitHub dashboard auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts signed sessions and rejects tampered tokens", () => {
    const token = createSessionToken("user-1");

    expect(verifySessionToken(token)).toMatchObject({ userId: "user-1" });
    expect(verifySessionToken(`${token}tampered`)).toBeNull();
  });

  it("only permits local paths or configured frontend origins as OAuth return targets", () => {
    expect(safeReturnTo("/pending?status=open")).toBe("/pending?status=open");
    expect(safeReturnTo("http://localhost:3088/decisions/123")).toBe("/decisions/123");
    expect(safeReturnTo("https://attacker.example/steal-session")).toBe("/");
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
