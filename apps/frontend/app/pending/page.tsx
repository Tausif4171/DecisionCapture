"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DecisionMemory } from "@decisioncapture/shared";
import { Check, Save, X } from "lucide-react";
import { approveDecision, listDecisions, rejectDecision, updateDecision } from "../../lib/api";
import {
  hasDecisionReviewChanges,
  hasRequiredDecisionReviewFields,
  toDecisionReviewDraft
} from "../../lib/decision-review";
import { EmptyState, ErrorState, LoadingState } from "../components/state-views";
import { StatusBadge } from "../components/status-badge";

function PendingDecisionEditor({ decision }: { decision: DecisionMemory }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDecisionReviewDraft(decision));
  const isDirty = hasDecisionReviewChanges(decision, draft);
  const hasRequiredFields = hasRequiredDecisionReviewFields(draft);

  const saveMutation = useMutation({
    mutationFn: () => updateDecision(decision.id, draft),
    onSuccess: async (updatedDecision) => {
      setDraft(toDecisionReviewDraft(updatedDecision));
      await queryClient.invalidateQueries({ queryKey: ["decision", decision.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const approveMutation = useMutation({
    mutationFn: () => approveDecision(decision.id, draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision", decision.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectDecision(decision.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision", decision.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const isBusy = saveMutation.isPending || approveMutation.isPending || rejectMutation.isPending;
  const actionError = saveMutation.error ?? approveMutation.error ?? rejectMutation.error;
  const helperMessage = saveMutation.isPending
    ? "Saving draft..."
    : saveMutation.isSuccess && !isDirty
      ? "Draft saved. This decision stays pending until you approve or reject it."
      : "Save draft keeps this decision pending until you approve or reject it.";

  function updateDraftField(
    field: "decision" | "reason" | "alternative" | "impact",
    value: string
  ) {
    if (saveMutation.isSuccess) {
      saveMutation.reset();
    }

    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <article className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={decision.status} />
          <span className="text-xs text-neutral-500">{Math.round(decision.confidence * 100)}% confidence</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || !hasRequiredFields || isBusy}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
            title="Save draft without approving"
          >
            <Save className="size-4" aria-hidden="true" />
            {saveMutation.isSuccess && !isDirty ? "Saved" : "Save draft"}
          </button>
          <button
            type="button"
            onClick={() => approveMutation.mutate()}
            disabled={!hasRequiredFields || isBusy}
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300"
            title="Approve pending decision"
          >
            <Check className="size-4" aria-hidden="true" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => rejectMutation.mutate()}
            disabled={isBusy}
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
            title="Reject pending decision"
          >
            <X className="size-4" aria-hidden="true" />
            Reject
          </button>
        </div>
      </div>
      <div className="grid gap-3">
        <label>
          <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Decision</span>
          <textarea
            value={draft.decision}
            onChange={(event) => updateDraftField("decision", event.target.value)}
            className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
          />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Reason</span>
          <textarea
            value={draft.reason}
            onChange={(event) => updateDraftField("reason", event.target.value)}
            className="mt-1 min-h-24 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
          />
        </label>
        <div className="grid gap-3 lg:grid-cols-2">
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Alternative</span>
            <textarea
              value={draft.alternative}
              onChange={(event) => updateDraftField("alternative", event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Impact</span>
            <textarea
              value={draft.impact}
              onChange={(event) => updateDraftField("impact", event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        {actionError instanceof Error ? (
          <p className="text-xs text-red-600">{actionError.message}</p>
        ) : null}
        <p className="flex items-center gap-2 text-xs text-neutral-500">
          <Save className="size-3.5" aria-hidden="true" />
          {helperMessage}
        </p>
      </div>
    </article>
  );
}

export default function PendingPage() {
  const pendingQuery = useQuery({
    queryKey: ["decisions", { status: "PENDING" }],
    queryFn: () => listDecisions({ status: "PENDING", sort: "recent", limit: 50 })
  });

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-semibold text-neutral-950">Pending decisions</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
          Low-confidence extractions wait here until the author or reviewer confirms the final memory.
        </p>
      </section>

      {pendingQuery.isLoading ? <LoadingState label="Loading pending decisions" /> : null}
      {pendingQuery.error ? <ErrorState message={pendingQuery.error.message} /> : null}
      {pendingQuery.data?.decisions.length === 0 ? (
        <EmptyState title="No pending decisions" description="Low-confidence captures will appear here for review." />
      ) : null}
      {pendingQuery.data?.decisions.length ? (
        <section className="space-y-3">
          {pendingQuery.data.decisions.map((decision) => (
            <PendingDecisionEditor key={decision.id} decision={decision} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
