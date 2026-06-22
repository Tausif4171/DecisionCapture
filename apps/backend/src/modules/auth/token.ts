import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

type OAuthStatePayload = {
  nonce: string;
  returnTo: string;
  expiresAt: number;
};

function requiredSessionSecret() {
  if (!env.AUTH_SESSION_SECRET) {
    throw new Error("AUTH_SESSION_SECRET is required when AUTH_MODE=github");
  }

  return env.AUTH_SESSION_SECRET;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  return createHmac("sha256", requiredSessionSecret()).update(payload).digest("base64url");
}

function encodeSignedPayload(payload: unknown) {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function decodeSignedPayload<T>(token: string): T | null {
  const [body, signature] = token.split(".");

  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  return JSON.parse(base64UrlDecode(body)) as T;
}

export function createSessionToken(userId: string) {
  return encodeSignedPayload({
    userId,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000
  } satisfies SessionPayload);
}

export function verifySessionToken(token: string) {
  const payload = decodeSignedPayload<SessionPayload>(token);

  if (!payload || payload.expiresAt < Date.now()) {
    return null;
  }

  return payload;
}

export function createOAuthState(returnTo: string) {
  return encodeSignedPayload({
    nonce: randomBytes(16).toString("base64url"),
    returnTo,
    expiresAt: Date.now() + 10 * 60 * 1_000
  } satisfies OAuthStatePayload);
}

export function verifyOAuthState(token: string) {
  const payload = decodeSignedPayload<OAuthStatePayload>(token);

  if (!payload || payload.expiresAt < Date.now()) {
    return null;
  }

  return payload;
}
