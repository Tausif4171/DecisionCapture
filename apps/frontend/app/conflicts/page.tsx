"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { listConflicts, reviewConflict } from "../../lib/api";
import { ConflictCard } from "../components/potential-conflicts";
import { useProtectedPageAccess } from "../components/protected-page-access";
import { EmptyState, ErrorState, LoadingState } from "../components/state-views";

export default function ConflictsPage() {
  const access = useProtectedPageAccess();
  const queryClient = useQueryClient();
  const conflictsQuery = useQuery({
    queryKey: ["conflicts", { status: "OPEN" }],
    queryFn: () => listConflicts({ status: "OPEN" }),
    enabled: access.canLoadProtectedData
  });
  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "dismiss" | "resolve" }) => reviewConflict(id, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    }
  });

  if (access.gate) {
    return access.gate;
  }

  if (conflictsQuery.isLoading) {
    return <LoadingState label="Loading potential conflicts" />;
  }

  if (conflictsQuery.error) {
    return <ErrorState message={conflictsQuery.error.message} />;
  }

  const overview = conflictsQuery.data;
  if (!overview?.enabled) {
    return (
      <div className="space-y-5">
        <PageIntro />
        <p className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          Conflict detection is disabled. Enable it only after the database, embedding model, queue, and GitHub permissions are verified.
        </p>
      </div>
    );
  }

  const openConflicts = overview.conflicts.filter((conflict) => conflict.status === "OPEN");

  return (
    <div className="space-y-5">
      <PageIntro />
      <section className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-start">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p>This is advisory context. A potential conflict never blocks a GitHub merge and still requires human review.</p>
      </section>
      {openConflicts.length ? (
        <section className="space-y-3" aria-labelledby="open-conflicts-heading">
          <div className="flex items-center justify-between">
            <h2 id="open-conflicts-heading" className="text-base font-semibold text-neutral-950">
              Open warnings ({openConflicts.length})
            </h2>
            <span className="text-xs text-neutral-500">Bounded, evidence-backed matches</span>
          </div>
          {openConflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              canManage={overview.canManage}
              busy={reviewMutation.isPending && reviewMutation.variables?.id === conflict.id}
              onReview={(action) => reviewMutation.mutate({ id: conflict.id, action })}
            />
          ))}
        </section>
      ) : (
        <EmptyState title="No open conflicts" description="No current PR warning has passed the configured evidence and confidence thresholds." />
      )}
    </div>
  );
}

function PageIntro() {
  return (
    <section>
      <p className="text-sm font-medium text-amber-700">Pre-review decision intelligence</p>
      <h1 className="mt-1 text-2xl font-semibold text-neutral-950">Potential conflicts</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
        Review possible conflicts between open pull requests and earlier approved or rejected decisions.
      </p>
    </section>
  );
}
