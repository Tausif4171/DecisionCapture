"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DecisionMemory } from "@decisioncapture/shared";
import { Check, GitBranch, LockKeyhole, Save, UserRound, X } from "lucide-react";
import { approveDecision, listDecisions, rejectDecision, updateDecision } from "../../lib/api";
import { formatExtractionConfidence } from "../../lib/decision-provenance";
import {
  hasDecisionReviewChanges,
  hasRequiredDecisionReviewFields,
  toDecisionReviewDraft
} from "../../lib/decision-review";
import { EmptyState, ErrorState, LoadingState } from "../components/state-views";
import { StatusBadge } from "../components/status-badge";
import { ReviewReasonCallout } from "../components/review-reason";

function PendingDecisionEditor({ decision }: { decision: DecisionMemory }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDecisionReviewDraft(decision));
  const canReview = Boolean(decision.reviewPermissions?.canReview);
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
    <article
      className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm"
      data-testid={`pending-decision-${decision.id}`}
    >
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={decision.status} />
            <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
              {decision.category}
            </span>
            <span className="text-xs text-neutral-500">{formatExtractionConfidence(decision.confidence)}</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-950">{decision.decision}</h2>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3.5" aria-hidden="true" />
              {decision.repository} {decision.sourcePR}
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {decision.author}
            </span>
          </div>
        </div>
        {canReview ? (
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
        ) : (
          <span className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-neutral-500">
            <LockKeyhole className="size-4" aria-hidden="true" />
            Read-only
          </span>
        )}
      </div>
      {decision.reviewReason ? (
        <div className="mb-4">
          <ReviewReasonCallout decision={decision} />
        </div>
      ) : null}
      {canReview ? (
        <>
          <div className="grid gap-3">
            <label>
              <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Decision</span>
              <textarea
                aria-label="Decision"
                value={draft.decision}
                onChange={(event) => updateDraftField("decision", event.target.value)}
                className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
              />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Reason</span>
              <textarea
                aria-label="Reason"
                value={draft.reason}
                onChange={(event) => updateDraftField("reason", event.target.value)}
                className="mt-1 min-h-24 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
              />
            </label>
            <div className="grid gap-3 lg:grid-cols-2">
              <label>
                <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Alternative</span>
                <textarea
                  aria-label="Alternative"
                  value={draft.alternative}
                  onChange={(event) => updateDraftField("alternative", event.target.value)}
                  className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
                />
              </label>
              <label>
                <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Impact</span>
                <textarea
                  aria-label="Impact"
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
        </>
      ) : (
        <dl className="grid gap-4 border-t border-neutral-100 pt-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Reason</dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">{decision.reason}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Alternative</dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">{decision.alternative || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Impact</dt>
            <dd className="mt-1 text-sm leading-6 text-neutral-700">{decision.impact}</dd>
          </div>
        </dl>
      )}
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
        <EmptyState title="No pending decisions" description="Low-confidence extractions will appear here for review." />
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
