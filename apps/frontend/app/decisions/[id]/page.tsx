"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  History,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X
} from "lucide-react";
import {
  approveDecision,
  getAuthStatus,
  getDecision,
  listDecisionAudit,
  rejectDecision,
  reopenDecision,
  updateDecision
} from "../../../lib/api";
import {
  formatExtractionConfidence,
  formatExtractionMethod
} from "../../../lib/decision-provenance";
import {
  hasDecisionReviewChanges,
  hasRequiredDecisionReviewFields,
  toDecisionReviewDraft,
  type DecisionReviewDraft
} from "../../../lib/decision-review";
import { ErrorState, LoadingState } from "../../components/state-views";
import { ReviewReasonCallout } from "../../components/review-reason";
import { StatusBadge } from "../../components/status-badge";

const FILE_PREVIEW_LIMIT = 8;
const AUDIT_PREVIEW_LIMIT = 6;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-normal text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-neutral-800">{value}</dd>
    </div>
  );
}

function formatAuditAction(action: string, actorLogin?: string | null) {
  const actor = actorLogin && actorLogin !== "system" ? actorLogin : "DecisionCapture";
  const labels: Record<string, string> = {
    CREATED: "Captured automatically",
    EDITED: `Draft edited by ${actor}`,
    APPROVED: `Approved by ${actor}`,
    REJECTED: `Rejected by ${actor}`,
    REOPENED: `Review reopened by ${actor}`
  };

  return labels[action] ?? action.toLowerCase().replace("_", " ");
}

function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DecisionReviewDraft | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showAllAudit, setShowAllAudit] = useState(false);

  const decisionQuery = useQuery({
    queryKey: ["decision", params.id],
    queryFn: () => getDecision(params.id)
  });

  const auditQuery = useQuery({
    queryKey: ["decision-audit", params.id],
    queryFn: () => listDecisionAudit(params.id),
    enabled: Boolean(decisionQuery.data)
  });

  const authQuery = useQuery({
    queryKey: ["auth"],
    queryFn: getAuthStatus,
    staleTime: 60_000
  });

  const decision = decisionQuery.data;
  const formValue = draft ?? (decision ? toDecisionReviewDraft(decision) : null);
  const isPendingDecision = decision?.status === "PENDING";
  const canReviewPendingDecision = Boolean(decision?.reviewPermissions?.canReview);
  const canReopen = Boolean(decision?.reviewPermissions?.canReopen);
  const isDirty = decision && formValue ? hasDecisionReviewChanges(decision, formValue) : false;
  const hasRequiredFields = formValue ? hasRequiredDecisionReviewFields(formValue) : false;
  const readOnlyMessage =
    decision?.status === "APPROVED"
      ? "Approved decisions are locked so the final engineering memory stays auditable."
      : "Rejected memories are kept read-only for audit. Reopen review if this decision needs another pass.";

  const updateMutation = useMutation({
    mutationFn: () => updateDecision(params.id, formValue!),
    onSuccess: async () => {
      setIsEditing(false);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decision-audit", params.id] });
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
      await queryClient.invalidateQueries({ queryKey: ["decision-audit", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectDecision(params.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decision-audit", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopenDecision(params.id, reopenReason),
    onSuccess: async () => {
      setIsReopenDialogOpen(false);
      setReopenReason("");
      await queryClient.invalidateQueries({ queryKey: ["decision", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decision-audit", params.id] });
      await queryClient.invalidateQueries({ queryKey: ["decisions"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
  });

  const isBusy =
    updateMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    reopenMutation.isPending;
  const actionError =
    updateMutation.error ?? approveMutation.error ?? rejectMutation.error ?? reopenMutation.error;

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

  const visibleFiles = showAllFiles
    ? decision.filesChanged
    : decision.filesChanged.slice(0, FILE_PREVIEW_LIMIT);
  const hasMoreFiles = decision.filesChanged.length > FILE_PREVIEW_LIMIT;
  const auditEntries = auditQuery.data ?? [];
  const visibleAudit = showAllAudit ? auditEntries : auditEntries.slice(0, AUDIT_PREVIEW_LIMIT);
  const hasMoreAudit = auditEntries.length > AUDIT_PREVIEW_LIMIT;

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
              <span className="text-xs text-neutral-500">{formatExtractionConfidence(decision.confidence)}</span>
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
            {isPendingDecision && canReviewPendingDecision ? (
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
            {isEditing && isPendingDecision && canReviewPendingDecision ? (
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
            {isPendingDecision && canReviewPendingDecision ? (
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
            {!isPendingDecision && canReopen ? (
              <button
                type="button"
                onClick={() => setIsReopenDialogOpen(true)}
                disabled={isBusy}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
                title="Reopen decision review"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reopen review
              </button>
            ) : null}
          </div>
        </div>
        {actionError instanceof Error ? (
          <p className="mt-3 text-sm text-red-600">{actionError.message}</p>
        ) : isPendingDecision && updateMutation.isSuccess ? (
          <p className="mt-3 text-sm text-neutral-500">
            Draft saved. This decision remains pending until you approve or reject it.
          </p>
        ) : isPendingDecision && authQuery.data && !canReviewPendingDecision ? (
          <p className="mt-3 text-sm text-neutral-500">
            Viewer access can inspect pending decisions. Review actions are limited to configured reviewers and PR
            participants.
          </p>
        ) : !isPendingDecision ? (
          <p className="mt-3 text-sm text-neutral-500">{readOnlyMessage}</p>
        ) : null}
        {isPendingDecision && decision.reviewReason ? (
          <div className="mt-4 max-w-3xl">
            <ReviewReasonCallout decision={decision} />
          </div>
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
            <p className="flex items-center gap-2">
              <Sparkles className="size-4 text-neutral-400" aria-hidden="true" />
              {formatExtractionMethod(decision.extractionMethod)}
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
            <div id="changed-files-list" className="space-y-2">
              {visibleFiles.map((file) => (
                <p key={file} className="break-all rounded-md bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                  {file}
                </p>
              ))}
            </div>
            {hasMoreFiles ? (
              <button
                type="button"
                onClick={() => setShowAllFiles((current) => !current)}
                aria-expanded={showAllFiles}
                aria-controls="changed-files-list"
                className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
              >
                {showAllFiles ? (
                  <ChevronUp className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4" aria-hidden="true" />
                )}
                {showAllFiles ? "Show fewer" : `Show all ${decision.filesChanged.length} files`}
              </button>
            ) : null}
          </div>
          <div className="border-t border-neutral-100 pt-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-950">
              <History className="size-4 text-neutral-500" aria-hidden="true" />
              Review
            </div>
            <div className="space-y-2 text-xs text-neutral-600">
              {visibleAudit.length ? (
                <ol className="space-y-2">
                  {visibleAudit.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-neutral-100 px-2 py-2">
                      <span className="font-medium text-neutral-800">
                        {formatAuditAction(entry.action, entry.actorLogin)}
                      </span>
                      <span className="block text-neutral-500">{formatAuditDate(entry.createdAt)}</span>
                      {entry.note ? <span className="mt-1 block text-neutral-600">{entry.note}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-neutral-500">Audit history is unavailable for this legacy record.</p>
              )}
              {hasMoreAudit ? (
                <button
                  type="button"
                  onClick={() => setShowAllAudit((current) => !current)}
                  className="mt-2 inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  {showAllAudit ? "Show recent activity" : `Show all ${auditEntries.length} events`}
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </section>

      {isReopenDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reopen-title"
            className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="reopen-title" className="text-lg font-semibold text-neutral-950">
                  Reopen review
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  The reason will be saved in the audit history.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReopenDialogOpen(false)}
                className="inline-flex size-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                title="Close"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Reason</span>
              <textarea
                autoFocus
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                className="mt-1 min-h-28 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
                placeholder="What changed or needs another review?"
              />
            </label>
            {reopenMutation.error instanceof Error ? (
              <p className="mt-2 text-sm text-red-600">{reopenMutation.error.message}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsReopenDialogOpen(false)}
                className="min-h-10 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => reopenMutation.mutate()}
                disabled={reopenReason.trim().length < 10 || reopenMutation.isPending}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-neutral-950 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-300"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reopen
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
