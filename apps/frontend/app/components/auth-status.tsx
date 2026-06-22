"use client";

import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Github, LogOut } from "lucide-react";
import { authLoginUrl, getAuthStatus, logout } from "../../lib/api";

export function AuthStatusControl() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: 60_000
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
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
      <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
        ) : (
          <Github className="size-4" aria-hidden="true" />
        )}
        <span className="font-medium">{user.login}</span>
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">
          {user.role.toLowerCase()}
        </span>
      </span>
      <button
        type="button"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 disabled:text-neutral-400"
        title="Sign out"
      >
        <LogOut className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
