export type TokenRefreshStrategy = "single-flight" | "parallel";

export const tokenRefreshStrategy: TokenRefreshStrategy = "single-flight";

export function shouldJoinTokenRefresh(inFlight: boolean) {
  return inFlight;
}