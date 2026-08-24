"use client";

import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DecisionContextLink,
  DecisionContextRelationshipType,
  ExternalContextStatus,
  ExternalContextType,
  GitHubIssueContextMetadata
} from "@decisioncapture/shared";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  History,
  Link as LinkIcon,
  Loader2,
  PencilLine,
  RotateCcw,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  approveDecision,
  createDecisionContextLink,
  deleteDecisionContextLink,
  getDecision,
  listDecisionContexts,
  listDecisionAudit,
  refreshDecisionContext,
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
import { useProtectedPageAccess } from "../../components/protected-page-access";
import { ErrorState, LoadingState } from "../../components/state-views";
import { ReviewReasonCallout } from "../../components/review-reason";
import { ReviewReasonDialog } from "../../components/review-reason-dialog";
import { GitHubIssuePicker } from "../../components/github-issue-picker";
import { SelectMenu } from "../../components/select-menu";
import { StatusBadge } from "../../components/status-badge";

const FILE_PREVIEW_LIMIT = 8;
const AUDIT_PREVIEW_LIMIT = 6;
const CONTEXT_TYPE_OPTIONS = [
  { value: "ARCHITECTURE_DOC", label: "Architecture doc" },
  { value: "ADR", label: "ADR" },
  { value: "ISSUE", label: "Issue" },
  { value: "MEETING", label: "Meeting" }
];
const RELATIONSHIP_OPTIONS = [
  { value: "RELATED", label: "Related" },
  { value: "ORIGINATED_FROM", label: "Originated from" },
  { value: "DOCUMENTS", label: "Documents" },
  { value: "DISCUSSED_IN", label: "Discussed in" }
];

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

function formatContextType(type: ExternalContextType) {
  const labels: Record<ExternalContextType, string> = {
    ISSUE: "Issue",
    ADR: "ADR",
    ARCHITECTURE_DOC: "Architecture doc",
    MEETING: "Meeting"
  };

  return labels[type];
}

function formatRelationship(type: DecisionContextRelationshipType) {
  const labels: Record<DecisionContextRelationshipType, string> = {
    RELATED: "Related",
    ORIGINATED_FROM: "Originated from",
    DOCUMENTS: "Documents",
    DISCUSSED_IN: "Discussed in"
  };

  return labels[type];
}

function formatContextStatus(status: ExternalContextStatus) {
  return status === "UNAVAILABLE" ? "Unavailable" : "Active";
}

function contextTitle(link: DecisionContextLink) {
  return link.context.title ?? link.context.normalizedUrl;
}

function githubIssueMetadata(link: DecisionContextLink) {
  if (link.context.provider !== "GITHUB" || !link.context.metadata) {
    return null;
  }

  const metadata = link.context.metadata;
  if (
    typeof metadata.repository !== "string" ||
    typeof metadata.issueNumber !== "number" ||
    typeof metadata.commentCount !== "number" ||
    !Array.isArray(metadata.labels) ||
    !Array.isArray(metadata.recentComments) ||
    (metadata.state !== "open" && metadata.state !== "closed")
  ) {
    return null;
  }

  return metadata as unknown as GitHubIssueContextMetadata;
}

function formatSyncStatus(link: DecisionContextLink) {
  if (link.context.status === "UNAVAILABLE") {
    return "Unavailable";
  }

  const labels = {
    PENDING: "Pending",
    SYNCING: "Syncing",
    SYNCED: "Synced",
    FAILED: "Sync failed",
    UNAVAILABLE: "Unavailable"
  } as const;

  return link.context.sync ? labels[link.context.sync.status] : formatContextStatus(link.context.status);
}

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const access = useProtectedPageAccess();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DecisionReviewDraft | null>(null);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [contextUrl, setContextUrl] = useState("");
  const [contextType, setContextType] = useState<ExternalContextType>("ISSUE");
  const [contextRelationship, setContextRelationship] =
    useState<DecisionContextRelationshipType>("RELATED");

  const decisionQuery = useQuery({
    queryKey: ["decision", params.id],
    queryFn: () => getDecision(params.id),
    enabled: access.canLoadProtectedData
  });

  const auditQuery = useQuery({
    queryKey: ["decision-audit", params.id],
    queryFn: () => listDecisionAudit(params.id),
    enabled: access.canLoadProtectedData && Boolean(decisionQuery.data)
  });
  const contextsQuery = useQuery({
    queryKey: ["decision-contexts", params.id],
    queryFn: () => listDecisionContexts(params.id),
    enabled: access.canLoadProtectedData && Boolean(decisionQuery.data)
  });
  const authQuery = access.authQuery;

  const decision = decisionQuery.data;
  const formValue = draft ?? (decision ? toDecisionReviewDraft(decision) : null);
  const isPendingDecision = decision?.status === "PENDING";
  const canReviewPendingDecision = Boolean(decision?.reviewPermissions?.canReview);
  const canReopen = Boolean(decision?.reviewPermissions?.canReopen);
  const isDirty = decision && formValue ? hasDecisionReviewChanges(decision, formValue) : false;
  const hasRequiredFields = formValue ? hasRequiredDecisionReviewFields(formValue) : false;
  const readOnlyMessage =
    decision?.status === "APPROVED"
      ? "Approved decisions are locked to preserve an auditable record."
      : "Rejected decisions remain read-only in the audit history. Reopen the review to reconsider this record.";

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
    mutationFn: () => rejectDecision(params.id, rejectReason),
    onSuccess: async () => {
      setIsRejectDialogOpen(false);
      setRejectReason("");
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

  const createContextMutation = useMutation({
    mutationFn: () =>
      createDecisionContextLink(params.id, {
        url: contextUrl.trim(),
        relationshipType: contextRelationship,
        type: contextType
      }),
    onSuccess: async () => {
      setContextUrl("");
      await queryClient.invalidateQueries({ queryKey: ["decision-contexts", params.id] });
    }
  });

  const deleteContextMutation = useMutation({
    mutationFn: (contextId: string) => deleteDecisionContextLink(params.id, contextId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision-contexts", params.id] });
    }
  });

  const refreshContextMutation = useMutation({
    mutationFn: (contextId: string) => refreshDecisionContext(params.id, contextId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision-contexts", params.id] });
    }
  });

  const isBusy =
    updateMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    reopenMutation.isPending;
  const isContextBusy =
    createContextMutation.isPending ||
    deleteContextMutation.isPending ||
    refreshContextMutation.isPending;
  const actionError = updateMutation.error ?? approveMutation.error;

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

  function submitContextLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!contextUrl.trim() || createContextMutation.isPending) {
      return;
    }

    createContextMutation.mutate();
  }

  if (access.gate) {
    return access.gate;
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
  const contextLinks = contextsQuery.data ?? [];
  const canManageContexts = Boolean(
    decision.reviewPermissions?.canReview || decision.reviewPermissions?.canReopen
  );
  const canManageGitHubIntegration = Boolean(
    authQuery.data?.authMode === "disabled" ||
      authQuery.data?.user?.role === "ADMIN" ||
      authQuery.data?.user?.role === "MAINTAINER"
  );

  return (
    <div className="space-y-5">
      <section className="rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
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
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-nowrap sm:justify-end">
            {isPendingDecision && canReviewPendingDecision ? (
              <button
                type="button"
                onClick={isEditing ? cancelEditing : startEditing}
                className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 ${
                  isEditing ? "order-1" : "order-2 sm:order-1"
                }`}
                title={isEditing ? "Cancel editing" : "Edit decision"}
              >
                {isEditing ? (
                  <X className="size-4" aria-hidden="true" />
                ) : (
                  <PencilLine className="size-4" aria-hidden="true" />
                )}
                {isEditing ? "Cancel" : "Edit"}
              </button>
            ) : null}
            {isEditing && isPendingDecision && canReviewPendingDecision ? (
              <button
                type="button"
                onClick={() => updateMutation.mutate()}
                disabled={!isDirty || !hasRequiredFields || isBusy}
                className="order-2 inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
                title="Save draft without approving"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {updateMutation.isPending ? "Saving..." : "Save draft"}
              </button>
            ) : null}
            {isPendingDecision && canReviewPendingDecision ? (
              <>
                <button
                  type="button"
                  onClick={() => approveMutation.mutate()}
                  disabled={!hasRequiredFields || isBusy}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:bg-emerald-300 ${
                    isEditing ? "order-3" : "order-1 col-span-2 sm:order-2 sm:col-auto"
                  }`}
                  title="Approve decision"
                >
                  {approveMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  {approveMutation.isPending ? "Approving..." : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    rejectMutation.reset();
                    setIsRejectDialogOpen(true);
                  }}
                  disabled={isBusy}
                  className={`${isEditing ? "order-4" : "order-3"} inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:border-neutral-200 disabled:text-neutral-400`}
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
                onClick={() => {
                  reopenMutation.reset();
                  setIsReopenDialogOpen(true);
                }}
                disabled={isBusy}
                className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400 sm:col-auto"
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
            Draft saved. This decision is still pending.
          </p>
        ) : isPendingDecision && authQuery.data && !canReviewPendingDecision ? (
          <p className="mt-3 text-sm text-neutral-500">
            You can view this decision, but only authorized reviewers and PR participants can review it.
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
            Source and provenance
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
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-950">
              <LinkIcon className="size-4 text-neutral-500" aria-hidden="true" />
              Linked context
            </div>
            {contextsQuery.isLoading ? (
              <p className="text-xs text-neutral-500">Loading context...</p>
            ) : contextLinks.length ? (
              <ul className="space-y-2">
                {contextLinks.map((link) => {
                  const githubMetadata = githubIssueMetadata(link);
                  const syncStatus = link.context.sync?.status;
                  const syncProblem =
                    link.context.status === "UNAVAILABLE" ||
                    syncStatus === "FAILED" ||
                    syncStatus === "UNAVAILABLE";
                  const syncPending = syncStatus === "PENDING" || syncStatus === "SYNCING";

                  return (
                    <li key={link.id} className="rounded-md border border-neutral-100 px-2 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <a
                            href={link.context.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-medium text-neutral-900 hover:text-emerald-700"
                          >
                            {contextTitle(link)}
                          </a>
                          <p className="mt-1 text-xs text-neutral-500">
                            {githubMetadata
                              ? `${githubMetadata.repository}#${githubMetadata.issueNumber} - ${githubMetadata.state}`
                              : `${formatContextType(link.context.type)} - ${formatRelationship(link.relationshipType)}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`rounded px-1.5 py-1 text-[11px] font-semibold ${
                              syncProblem
                                ? "bg-red-50 text-red-700"
                                : syncPending
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {formatSyncStatus(link)}
                          </span>
                          {canManageContexts && link.context.provider === "GITHUB" ? (
                            <button
                              type="button"
                              onClick={() => refreshContextMutation.mutate(link.externalContextId)}
                              disabled={isContextBusy}
                              className="inline-flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:text-neutral-300"
                              title="Refresh GitHub issue"
                              aria-label={`Refresh ${contextTitle(link)}`}
                            >
                              <RefreshCw
                                className={`size-4 ${
                                  refreshContextMutation.isPending &&
                                  refreshContextMutation.variables === link.externalContextId
                                    ? "animate-spin"
                                    : ""
                                }`}
                                aria-hidden="true"
                              />
                            </button>
                          ) : null}
                          {canManageContexts ? (
                            <button
                              type="button"
                              onClick={() => deleteContextMutation.mutate(link.externalContextId)}
                              disabled={isContextBusy}
                              className="inline-flex size-8 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-700 disabled:text-neutral-300"
                              title="Remove context link"
                              aria-label={`Remove context link ${contextTitle(link)}`}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {link.context.description ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-neutral-600">
                          {link.context.description}
                        </p>
                      ) : null}
                      {githubMetadata ? (
                        <>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                            {githubMetadata.authorLogin ? <span>@{githubMetadata.authorLogin}</span> : null}
                            <span>{githubMetadata.commentCount} comments</span>
                            {githubMetadata.labels.slice(0, 4).map((label) => (
                              <span key={label.name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700">
                                {label.name}
                              </span>
                            ))}
                          </div>
                          {githubMetadata.recentComments.length ? (
                            <details className="mt-2 text-xs text-neutral-600">
                              <summary className="cursor-pointer font-medium text-neutral-700">
                                Recent comments
                              </summary>
                              <ol className="mt-2 space-y-2 border-l border-neutral-200 pl-2">
                                {githubMetadata.recentComments.slice(-3).map((comment) => (
                                  <li key={comment.id}>
                                    <a
                                      href={comment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-medium text-neutral-700 hover:text-emerald-700"
                                    >
                                      {comment.authorLogin ? `@${comment.authorLogin}` : "GitHub user"}
                                    </a>
                                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap leading-5">
                                      {comment.body}
                                    </p>
                                  </li>
                                ))}
                              </ol>
                            </details>
                          ) : null}
                        </>
                      ) : null}
                      {link.context.sync?.error ? (
                        <p className="mt-2 text-xs text-red-600">{link.context.sync.error}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-neutral-500">No context linked.</p>
            )}
            {contextsQuery.error instanceof Error ? (
              <p className="mt-2 text-xs text-red-600">{contextsQuery.error.message}</p>
            ) : null}
            {canManageContexts ? (
              <form className="mt-3 space-y-2" onSubmit={submitContextLink}>
                {contextType === "ISSUE" ? (
                  <GitHubIssuePicker
                    defaultRepository={decision.repository}
                    canManageIntegration={canManageGitHubIntegration}
                    disabled={isContextBusy}
                    onSelect={(url) => {
                      createContextMutation.reset();
                      setContextUrl(url);
                    }}
                  />
                ) : null}
                <label className="block">
                  <span className="sr-only">Context URL</span>
                  <input
                    value={contextUrl}
                    onChange={(event) => {
                      createContextMutation.reset();
                      setContextUrl(event.target.value);
                    }}
                    placeholder="https://github.com/org/repo/issues/42"
                    className="min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none transition focus:border-neutral-400"
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SelectMenu
                    label="Context type"
                    value={contextType}
                    options={CONTEXT_TYPE_OPTIONS}
                    onChange={(value) => setContextType(value as ExternalContextType)}
                  />
                  <SelectMenu
                    label="Relationship type"
                    value={contextRelationship}
                    options={RELATIONSHIP_OPTIONS}
                    onChange={(value) =>
                      setContextRelationship(value as DecisionContextRelationshipType)
                    }
                  />
                </div>
                <button
                  type="submit"
                  disabled={!contextUrl.trim() || createContextMutation.isPending}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:text-neutral-400"
                  title="Link context"
                >
                  {createContextMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LinkIcon className="size-4" aria-hidden="true" />
                  )}
                  {createContextMutation.isPending ? "Linking..." : "Link context"}
                </button>
                {createContextMutation.error instanceof Error ? (
                  <p className="text-xs text-red-600">{createContextMutation.error.message}</p>
                ) : null}
                {deleteContextMutation.error instanceof Error ? (
                  <p className="text-xs text-red-600">{deleteContextMutation.error.message}</p>
                ) : null}
                {refreshContextMutation.error instanceof Error ? (
                  <p className="text-xs text-red-600">{refreshContextMutation.error.message}</p>
                ) : null}
              </form>
            ) : null}
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
              Audit history
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

      <ReviewReasonDialog
        open={isRejectDialogOpen}
        title="Reject decision"
        description="The decision will remain available in the audit history."
        label="Reason for rejection"
        placeholder="Why should this decision not become permanent memory?"
        value={rejectReason}
        confirmLabel="Reject decision"
        pendingLabel="Rejecting..."
        destructive
        isPending={rejectMutation.isPending}
        error={rejectMutation.error}
        onChange={setRejectReason}
        onClose={() => {
          setIsRejectDialogOpen(false);
          setRejectReason("");
          rejectMutation.reset();
        }}
        onConfirm={() => rejectMutation.mutate()}
      />
      <ReviewReasonDialog
        open={isReopenDialogOpen}
        title="Reopen review"
        description="The reason will be saved in the audit history."
        label="Reason for reopening"
        placeholder="What changed or needs another review?"
        value={reopenReason}
        confirmLabel="Reopen review"
        pendingLabel="Reopening..."
        isPending={reopenMutation.isPending}
        error={reopenMutation.error}
        onChange={setReopenReason}
        onClose={() => {
          setIsReopenDialogOpen(false);
          setReopenReason("");
          reopenMutation.reset();
        }}
        onConfirm={() => reopenMutation.mutate()}
      />
    </div>
  );
}
