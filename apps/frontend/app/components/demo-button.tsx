"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCw } from "lucide-react";
import { createDemoPr } from "../../lib/api";

export function DemoButton() {
  const queryClient = useQueryClient();
  const demoMutation = useMutation({
    mutationFn: createDemoPr,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["decisions"] });
        void queryClient.invalidateQueries({ queryKey: ["stats"] });
      }, 1500);
    }
  });

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => demoMutation.mutate()}
        disabled={demoMutation.isPending}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
        title="Run demo PR"
      >
        {demoMutation.isPending ? (
          <RotateCw className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        Run Demo PR
      </button>
      {demoMutation.data ? <p className="text-sm text-neutral-600">{demoMutation.data.message}</p> : null}
      {demoMutation.error ? <p className="text-sm text-red-600">{demoMutation.error.message}</p> : null}
    </div>
  );
}
