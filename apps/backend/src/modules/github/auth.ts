import { createSign } from "node:crypto";
import { env } from "../../config/env.js";

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
};

const cachedInstallationTokens = new Map<string, { token: string; expiresAt: number }>();

export function hasGitHubAppCredentials() {
  return Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY
  );
}

function encodeJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createGitHubAppJwt() {
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

async function createInstallationToken(installationId: string) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${createGitHubAppJwt()}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "DecisionCapture"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub App installation token request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as InstallationTokenResponse;
  cachedInstallationTokens.set(installationId, {
    token: payload.token,
    expiresAt: new Date(payload.expires_at).getTime()
  });

  return payload.token;
}

export function hasGitHubApiCredentials() {
  return hasGitHubAppCredentials() || Boolean(env.GITHUB_API_TOKEN);
}

export async function getGitHubApiToken(installationId = env.GITHUB_APP_INSTALLATION_ID) {
  if (!hasGitHubAppCredentials()) {
    return env.GITHUB_API_TOKEN;
  }

  if (!installationId) {
    throw new Error("GitHub App installation ID is not configured");
  }

  const cachedInstallationToken = cachedInstallationTokens.get(installationId);
  if (cachedInstallationToken && cachedInstallationToken.expiresAt - Date.now() > 5 * 60_000) {
    return cachedInstallationToken.token;
  }

  return createInstallationToken(installationId);
}

export function invalidateGitHubApiToken(installationId = env.GITHUB_APP_INSTALLATION_ID) {
  if (installationId) {
    cachedInstallationTokens.delete(installationId);
  }
}
