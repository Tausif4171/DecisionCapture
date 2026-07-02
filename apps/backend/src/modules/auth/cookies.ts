import { env } from "../../config/env.js";

export const sessionCookieName = "decisioncapture_session";
export const oauthStateCookieName = "decisioncapture_oauth_state";
const sevenDaysInSeconds = 60 * 60 * 24 * 7;
const tenMinutesInSeconds = 60 * 10;

export function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();

  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    env.NODE_ENV === "production" ? "SameSite=None" : "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function sessionCookie(value: string) {
  return serializeCookie(sessionCookieName, value, sevenDaysInSeconds);
}

export function oauthStateCookie(value: string) {
  return serializeCookie(oauthStateCookieName, value, tenMinutesInSeconds);
}

export function clearCookie(name: string) {
  return serializeCookie(name, "", 0);
}
