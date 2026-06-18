"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, GitBranch, Save, ShieldCheck, UserRound, X } from "lucide-react";
import { approveDecision, getDecision, rejectDecision, updateDecision } from "../../../lib/api";
import {
  hasDecisionReviewChanges,
  hasRequiredDecisionReviewFields,
  toDecisionReviewDraft,
  type DecisionReviewDraft
} from "../../../lib/decision-review";
import { ErrorState, LoadingState } from "../../components/state-views";
import { StatusBadge } from "../../components/status-badge";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-normal text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-neutral-800">{value}</dd>
    </div>
  );
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DecisionReviewDraft | null>(null);

  const decisionQuery = useQuery({
    queryKey: ["decision", params.id],
    queryFn: () => getDecision(params.id)
  });

  const decision = decisionQuery.data;
  const formValue = draft ?? (decision ? toDecisionReviewDraft(decision) : null);
  const isPendingDecision = decision?.status === "PENDING";
  const isDirty = decision && formValue ? hasDecisionReviewChanges(decision, formValue) : false;
  const hasRequiredFields = formValue ? hasRequiredDecisionReviewFields(formValue) : false;
  const readOnlyMessage =
    decision?.status === "APPROVED"
      ? "Approved decisions are locked so the final engineering memory stays auditable."
      : "Rejected decisions stay read-only as review history.";

  const updateMutation = useMutation({
    mutationFn: () => updateDecision(params.id, formValue!),
    onSuccess: async () => {
      setIsEditing(false);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const approveMutation = useMutation({
    mutationFn: () => approveDecision(params.id, formValue!),
    onSuccess: async () => {
      setIsEditing(false);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectDecision(params.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const isBusy = updateMutation.isPending || approveMutation.isPending || rejectMutation.isPending;
  const actionError = updateMutation.error ?? approveMutation.error ?? rejectMutation.error;

  function startEditing() {
    if (!decision) {
      return;
    }

    if (updateMutation.isSuccess) {
      updateMutation.reset();
    }

    setDraft(toDecisionReviewDraft(decision));
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setDraft(null);
  }

  function updateDraftField(
    field: "decision" | "reason" | "alternative" | "impact",
    value: string
  ) {
    if (updateMutation.isSuccess) {
      updateMutation.reset();
    }

    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  if (decisionQuery.isLoading) {
    return <LoadingState label="Loading decision" />;
  }

  if (decisionQuery.error || !decision) {
    return <ErrorState message={decisionQuery.error?.message ?? "Decision was not found"} />;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={decision.status} />
              <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                {decision.category}
              </span>
              <span className="text-xs text-neutral-500">{Math.round(decision.confidence * 100)}% confidence</span>
            </div>
            {isEditing ? (
              <textarea
                value={formValue?.decision ?? ""}
                onChange={(event) => updateDraftField("decision", event.target.value)}
                className="min-h-24 w-full rounded-md border border-neutral-200 p-3 text-xl font-semibold text-neutral-950 outline-none focus:border-neutral-400"
              />
            ) : (
              <h1 className="text-2xl font-semibold text-neutral-950">{decision.decision}</h1>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isPendingDecision ? (
              <button
                type="button"
                onClick={isEditing ? cancelEditing : startEditing}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
                title={isEditing ? "Cancel editing" : "Edit decision"}
              >
                {isEditing ? <X className="size-4" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {isEditing ? "Cancel" : "Edit"}
              </button>
            ) : null}
            {isEditing && isPendingDecision ? (
              <button
                type="button"
                onClick={() => updateMutation.mutate()}
                disabled={!isDirty || !hasRequiredFields || isBusy}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
                title="Save draft without approving"
              >
                <Save className="size-4" aria-hidden="true" />
                Save draft
              </button>
            ) : null}
            {isPendingDecision ? (
              <>
                <button
                  type="button"
                  onClick={() => approveMutation.mutate()}
                  disabled={!hasRequiredFields || isBusy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300"
                  title="Approve decision"
                >
                  <Check className="size-4" aria-hidden="true" />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => rejectMutation.mutate()}
                  disabled={isBusy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
                  title="Reject decision"
                >
                  <X className="size-4" aria-hidden="true" />
                  Reject
                </button>
              </>
            ) : null}
          </div>
        </div>
        {actionError instanceof Error ? (
          <p className="mt-3 text-sm text-red-600">{actionError.message}</p>
        ) : updateMutation.isSuccess ? (
          <p className="mt-3 text-sm text-neutral-500">
            Draft saved. This decision remains pending until you approve or reject it.
          </p>
        ) : !isPendingDecision ? (
          <p className="mt-3 text-sm text-neutral-500">{readOnlyMessage}</p>
        ) : null}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4 rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
          {isEditing ? (
            <>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Reason</span>
                <textarea
                  value={formValue?.reason ?? ""}
                  onChange={(event) => updateDraftField("reason", event.target.value)}
                  className="mt-1 min-h-28 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Alternative</span>
                <textarea
                  value={formValue?.alternative ?? ""}
                  onChange={(event) => updateDraftField("alternative", event.target.value)}
                  className="mt-1 min-h-20 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Impact</span>
                <textarea
                  value={formValue?.impact ?? ""}
                  onChange={(event) => updateDraftField("impact", event.target.value)}
                  className="mt-1 min-h-24 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
                />
              </label>
            </>
          ) : (
            <dl className="space-y-5">
              <Field label="Reason" value={decision.reason} />
              <Field label="Alternative" value={decision.alternative ?? "No alternative captured"} />
              <Field label="Impact" value={decision.impact} />
            </dl>
          )}
        </div>

        <aside className="space-y-4 rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
            <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
            Source
          </div>
          <div className="space-y-3 text-sm text-neutral-600">
            <p className="flex items-center gap-2">
              <GitBranch className="size-4 text-neutral-400" aria-hidden="true" />
              {decision.repository} {decision.sourcePR}
            </p>
            <p className="flex items-center gap-2">
              <UserRound className="size-4 text-neutral-400" aria-hidden="true" />
              {decision.author}
            </p>
            <a
              href={`https://github.com/${decision.repository}/pull/${decision.sourcePR.replace("PR #", "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-medium text-neutral-900 hover:text-emerald-700"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Open PR
            </a>
          </div>
          <div className="border-t border-neutral-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-normal text-neutral-500">Files changed</p>
            <div className="space-y-2">
              {decision.filesChanged.map((file) => (
                <p key={file} className="break-all rounded-md bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                  {file}
                </p>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
