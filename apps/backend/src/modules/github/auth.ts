import { createSign } from "node:crypto";
import { env } from "../../config/env.js";

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
};

let cachedInstallationToken: { token: string; expiresAt: number } | null = null;

function hasGitHubAppCredentials() {
  return Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY
  );
}

function encodeJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createAppJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: env.GITHUB_APP_ID
  });
  const unsignedToken = `${header}.${payload}`;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256")
    .update(unsignedToken)
    .end()
    .sign(privateKey, "base64url");

  return `${unsignedToken}.${signature}`;
}

async function createInstallationToken() {
  const response = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${createAppJwt()}`,
        "user-agent": "DecisionCapture"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub App installation token request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as InstallationTokenResponse;
  cachedInstallationToken = {
    token: payload.token,
    expiresAt: new Date(payload.expires_at).getTime()
  };

  return payload.token;
}

export function hasGitHubApiCredentials() {
  return hasGitHubAppCredentials() || Boolean(env.GITHUB_API_TOKEN);
}

export async function getGitHubApiToken() {
  if (!hasGitHubAppCredentials()) {
    return env.GITHUB_API_TOKEN;
  }

  if (cachedInstallationToken && cachedInstallationToken.expiresAt - Date.now() > 5 * 60_000) {
    return cachedInstallationToken.token;
  }

  return createInstallationToken();
}
