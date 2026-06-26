export function normalizeOAuthSessionKey(userId: string, provider: string) {
  return `${provider}:${userId}`;
}