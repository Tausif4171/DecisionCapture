"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthStatus, UserRole } from "@decisioncapture/shared";
import { Github, Loader2, LogOut } from "lucide-react";
import { authLoginUrl, getAuthStatus, logout } from "../../lib/api";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Admin",
  MAINTAINER: "Maintainer",
  REVIEWER: "Reviewer",
  VIEWER: "Viewer"
};

export function AuthStatusControl() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authQuery = useQuery<AuthStatus>({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: 60_000
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth"
      });
      queryClient.setQueryData<AuthStatus>(["auth"], {
        authMode: authQuery.data?.authMode ?? "github",
        authenticated: false
      });
      router.replace("/");
    }
  });

  if (!authQuery.data || authQuery.data.authMode === "disabled") {
    return null;
  }

  if (!authQuery.data.authenticated || !authQuery.data.user) {
    return (
      <a
        href={authLoginUrl(pathname)}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
      >
        <Github className="size-4" aria-hidden="true" />
        Sign in
      </a>
    );
  }

  const { user } = authQuery.data;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {logoutMutation.error ? (
        <div
          className="fixed right-4 top-4 z-[60] rounded-md border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 shadow-lg"
          role="alert"
        >
          Couldn&apos;t sign out. Try again.
        </div>
      ) : null}
      <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
        ) : (
          <Github className="size-4" aria-hidden="true" />
        )}
        <span className="font-medium">{user.login}</span>
        <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
          {roleLabels[user.role]}
        </span>
      </span>
      <button
        type="button"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400"
        title={logoutMutation.isPending ? "Signing out" : "Sign out"}
        aria-label={logoutMutation.isPending ? "Signing out" : "Sign out"}
      >
        {logoutMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="size-4" aria-hidden="true" />
        )}
        <span>{logoutMutation.isPending ? "Signing out" : "Sign out"}</span>
      </button>
    </div>
  );
}
