"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DecisionRelationship,
  DecisionRelationshipType,
  DecisionStatus
} from "@decisioncapture/shared";
import {
  AlertTriangle,
  Check,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Sparkles,
  X
} from "lucide-react";
import {
  acceptDecisionRelationship,
  analyzeDecisionRelationships,
  dismissDecisionRelationship,
  getDecisionRelationships
} from "../../lib/api";

const ACTIVE_ANALYSIS_POLL_INTERVAL_MS = 1_000;

function relationshipLabel(relationship: DecisionRelationship) {
  const outgoingLabels: Record<DecisionRelationshipType, string> = {
    RELATED: "Related to",
    BUILDS_ON: "Builds on",
    SUPERSEDES: "Supersedes",
    POSSIBLE_CONFLICT: "Possible conflict with"
  };
  const incomingLabels: Record<DecisionRelationshipType, string> = {
    RELATED: "Related to",
    BUILDS_ON: "Built on by",
    SUPERSEDES: "Superseded by",
    POSSIBLE_CONFLICT: "Possible conflict with"
  };

  return relationship.direction === "OUTGOING"
    ? outgoingLabels[relationship.type]
    : incomingLabels[relationship.type];
}

function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

function analysisDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function RelationshipSummary({
  relationship,
  suggestion,
  busy,
  canManage,
  onAccept,
  onDismiss
}: {
  relationship: DecisionRelationship;
  suggestion: boolean;
  busy: boolean;
  canManage: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const possibleConflict = relationship.type === "POSSIBLE_CONFLICT";

  return (
    <li
      className={`rounded-md border bg-white p-4 shadow-sm ${
        possibleConflict ? "border-amber-200" : "border-neutral-200"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={possibleConflict ? "text-amber-700" : "text-emerald-700"}>
              {relationshipLabel(relationship)}
            </span>
            <span className="rounded bg-neutral-100 px-1.5 py-1 font-medium text-neutral-600">
              {confidenceLabel(relationship.confidence)}
            </span>
            {!suggestion ? (
              <span className="rounded bg-emerald-50 px-1.5 py-1 text-emerald-700">Confirmed</span>
            ) : null}
          </div>
          <a
            href={`/decisions/${relationship.relatedDecision.id}`}
            className="mt-2 block break-words text-sm font-semibold leading-6 text-neutral-950 hover:text-emerald-700"
          >
            {relationship.relatedDecision.decision}
          </a>
          <p className="mt-1 text-xs text-neutral-500">
            {relationship.relatedDecision.sourcePR} - {relationship.relatedDecision.category}
          </p>
        </div>
        {suggestion && canManage ? (
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
            >
              <X className="size-4" aria-hidden="true" />
              Dismiss
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-neutral-950 px-3 text-xs font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Accept
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-700">{relationship.explanation}</p>
      {relationship.evidence.length ? (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Evidence</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-neutral-600">
            {relationship.evidence.map((evidence) => (
              <li key={evidence} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-neutral-400" aria-hidden="true" />
                <span>{evidence}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!suggestion && relationship.reviewedByLogin ? (
        <p className="mt-3 text-xs text-neutral-500">Confirmed by {relationship.reviewedByLogin}</p>
      ) : null}
    </li>
  );
}

export function DecisionRelationships({
  decisionId,
  decisionStatus
}: {
  decisionId: string;
  decisionStatus: DecisionStatus;
}) {
  const queryClient = useQueryClient();
  const relationshipsQuery = useQuery({
    queryKey: ["decision-relationships", decisionId],
    queryFn: () => getDecisionRelationships(decisionId),
    refetchInterval: (query) => {
      const status = query.state.data?.analysis?.status;
      return status === "PENDING" || status === "RUNNING"
        ? ACTIVE_ANALYSIS_POLL_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: false
  });

  const invalidateRelationshipState = async () => {
    await queryClient.invalidateQueries({ queryKey: ["decision-relationships", decisionId] });
    await queryClient.invalidateQueries({ queryKey: ["decision-audit", decisionId] });
  };

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeDecisionRelationships(decisionId),
    onSuccess: invalidateRelationshipState
  });
  const acceptMutation = useMutation({
    mutationFn: (relationshipId: string) =>
      acceptDecisionRelationship(decisionId, relationshipId),
    onSuccess: invalidateRelationshipState
  });
  const dismissMutation = useMutation({
    mutationFn: (relationshipId: string) =>
      dismissDecisionRelationship(decisionId, relationshipId),
    onSuccess: invalidateRelationshipState
  });

  if (relationshipsQuery.isLoading) {
    return null;
  }

  if (relationshipsQuery.error) {
    return (
      <section className="mt-6 border-t border-neutral-200 pt-6" aria-labelledby="decision-relationships-title">
        <h2 id="decision-relationships-title" className="text-base font-semibold text-neutral-950">
          Decision relationships
        </h2>
        <p className="mt-2 text-sm text-red-700">Relationship analysis is temporarily unavailable.</p>
      </section>
    );
  }

  const overview = relationshipsQuery.data;
  if (!overview?.enabled) {
    return null;
  }

  const analysisActive =
    overview.analysis?.status === "PENDING" || overview.analysis?.status === "RUNNING";
  const reviewBusy = acceptMutation.isPending || dismissMutation.isPending;
  const canAnalyze = overview.canManage && decisionStatus === "APPROVED";
  const actionError = analyzeMutation.error ?? acceptMutation.error ?? dismissMutation.error;

  return (
    <section className="mt-8 border-t border-neutral-200 pt-7" aria-labelledby="decision-relationships-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="size-5 text-emerald-600" aria-hidden="true" />
            <h2 id="decision-relationships-title" className="text-base font-semibold text-neutral-950">
              Decision relationships
            </h2>
          </div>
          <p className="mt-1 text-sm text-neutral-600">
            Evidence-backed connections to earlier engineering decisions.
          </p>
        </div>
        {canAnalyze ? (
          <button
            type="button"
            onClick={() => analyzeMutation.mutate()}
            disabled={analysisActive || analyzeMutation.isPending}
            className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 disabled:text-neutral-400"
          >
            {analysisActive || analyzeMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : overview.analysis ? (
              <RefreshCw className="size-4" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {analysisActive || analyzeMutation.isPending
              ? "Analyzing..."
              : overview.analysis
                ? "Analyze again"
                : "Analyze relationships"}
          </button>
        ) : null}
      </div>

      {decisionStatus !== "APPROVED" ? (
        <p className="mt-5 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          Relationships are analyzed after this decision is approved.
        </p>
      ) : null}

      {overview.analysis?.status === "FAILED" ? (
        <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{overview.analysis.error ?? "Relationship analysis failed. Try again."}</span>
        </div>
      ) : null}

      {actionError instanceof Error ? (
        <p className="mt-4 text-sm text-red-700">{actionError.message}</p>
      ) : null}

      {overview.confirmed.length ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-neutral-900">Confirmed</h3>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {overview.confirmed.map((relationship) => (
              <RelationshipSummary
                key={relationship.id}
                relationship={relationship}
                suggestion={false}
                busy={false}
                canManage={overview.canManage}
                onAccept={() => undefined}
                onDismiss={() => undefined}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {overview.suggestions.length ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">Needs review</h3>
            <span className="rounded bg-amber-50 px-1.5 py-1 text-xs font-semibold text-amber-700">
              {overview.suggestions.length} suggested
            </span>
          </div>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {overview.suggestions.map((relationship) => (
              <RelationshipSummary
                key={relationship.id}
                relationship={relationship}
                suggestion
                busy={
                  reviewBusy &&
                  (acceptMutation.variables === relationship.id ||
                    dismissMutation.variables === relationship.id)
                }
                canManage={overview.canManage}
                onAccept={() => acceptMutation.mutate(relationship.id)}
                onDismiss={() => dismissMutation.mutate(relationship.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {decisionStatus === "APPROVED" &&
      overview.analysis?.status === "COMPLETED" &&
      !overview.suggestions.length &&
      !overview.confirmed.length ? (
        <p className="mt-5 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          No evidence-backed relationships were found.
        </p>
      ) : null}

      {decisionStatus === "APPROVED" && !overview.analysis && !overview.confirmed.length ? (
        <p className="mt-5 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          Analyze this decision to look for supported relationships with earlier decisions.
        </p>
      ) : null}

      {overview.analysis?.lastSuccessAt ? (
        <p className="mt-4 text-xs text-neutral-500">
          Last analyzed {analysisDate(overview.analysis.lastSuccessAt)} - {overview.analysis.candidateCount} candidates checked
        </p>
      ) : null}
    </section>
  );
}
