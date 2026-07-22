"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuthStatus } from "@decisioncapture/shared";
import { getAuthStatus } from "../../lib/api";
import { ErrorState, LoadingState } from "./state-views";

export function useProtectedPageAccess() {
  const authQuery = useQuery<AuthStatus>({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: 60_000
  });
  const authStatus = authQuery.data;

  if (authQuery.isLoading) {
    return {
      authQuery,
      canLoadProtectedData: false,
      gate: <LoadingState label="Checking access" />
    };
  }

  if (authQuery.error) {
    return {
      authQuery,
      canLoadProtectedData: false,
      gate: <ErrorState message={authQuery.error.message} />
    };
  }

  if (authStatus?.authMode === "github" && !authStatus.authenticated) {
    return {
      authQuery,
      canLoadProtectedData: false,
      gate: <ErrorState message="GitHub sign-in is required" />
    };
  }

  return {
    authQuery,
    canLoadProtectedData: true,
    gate: null
  };
}
