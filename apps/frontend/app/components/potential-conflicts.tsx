"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DecisionConflict, DecisionConflictStatus, DecisionStatus } from "@decisioncapture/shared";
import { AlertTriangle, Check, ExternalLink, Loader2, ShieldAlert, X } from "lucide-react";
import { getDecisionConflicts, reviewConflict } from "../../lib/api";
import { ErrorState, LoadingState } from "./state-views";

function statusLabel(status: DecisionConflictStatus) {
  return {
    OPEN: "Open",
    DISMISSED: "Dismissed",
    RESOLVED: "Resolved",
    STALE: "Stale"
  }[status];
}

function decisionStatusLabel(status: DecisionStatus) {
  return status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Pending";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ConflictCard({
  conflict,
  canManage,
  onReview,
  busy
}: {
  conflict: DecisionConflict;
  canManage: boolean;
  onReview: (action: "dismiss" | "resolve") => void;
  busy: boolean;
}) {
  const isOpen = conflict.status === "OPEN";

  return (
    <article className={`rounded-md border bg-white p-4 shadow-sm ${isOpen ? "border-amber-200" : "border-neutral-200"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={isOpen ? "text-amber-700" : "text-neutral-600"}>
              {isOpen ? "Potential conflict" : statusLabel(conflict.status)}
            </span>
            <span className="rounded bg-neutral-100 px-1.5 py-1 font-medium text-neutral-600">
              {Math.round(conflict.confidence * 100)}% confidence
            </span>
            <span className="rounded bg-neutral-100 px-1.5 py-1 font-medium text-neutral-600">
              {decisionStatusLabel(conflict.historicalDecision.status)} decision
            </span>
            <span className="rounded bg-neutral-100 px-1.5 py-1 font-medium text-neutral-600">
              {conflict.pullRequestState === "OPEN" ? "Open PR" : "Closed PR"}
            </span>
          </div>
          <h3 className="mt-2 break-words text-sm font-semibold leading-6 text-neutral-950">
            {conflict.historicalDecision.decision}
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            {conflict.prTitle} - PR #{conflict.prNumber} - detected {dateLabel(conflict.createdAt)}
          </p>
        </div>
        {isOpen && canManage ? (
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => onReview("dismiss")}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => onReview("resolve")}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-neutral-950 px-3 text-xs font-medium text-white hover:bg-neutral-800 disabled:bg-neutral-300"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              Resolve
            </button>
          </div>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-neutral-700">{conflict.explanation}</p>
      {conflict.evidence.length ? (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-normal text-neutral-500">Evidence</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-neutral-600">
            {conflict.evidence.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-neutral-400" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <span>Similarity {Math.round(conflict.similarityScore * 100)}%</span>
        <span>Commit {conflict.headSha.slice(0, 8)}</span>
        <Link href={`/decisions/${conflict.historicalDecision.id}`} className="inline-flex items-center gap-1 font-medium text-neutral-700 hover:text-emerald-700">
          Read historical decision
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
        <a href={conflict.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-neutral-700 hover:text-emerald-700">
          Open PR
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      {conflict.reviewNote ? <p className="mt-2 text-xs text-neutral-500">Review note: {conflict.reviewNote}</p> : null}
    </article>
  );
}

export function PotentialConflicts({
  decisionId,
  decisionStatus
}: {
  decisionId: string;
  decisionStatus: DecisionStatus;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["decision-conflicts", decisionId],
    queryFn: () => getDecisionConflicts(decisionId)
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "dismiss" | "resolve" }) => reviewConflict(id, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision-conflicts", decisionId] });
      await queryClient.invalidateQueries({ queryKey: ["conflicts"] });
    }
  });

  if (query.isLoading) {
    return <LoadingState label="Loading potential conflicts" />;
  }

  if (query.error) {
    return <ErrorState message={query.error.message} />;
  }

  const overview = query.data;
  if (!overview?.enabled) {
    return (
      <section className="border-t border-neutral-200 pt-6" aria-labelledby="potential-conflicts-heading">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
          <ShieldAlert className="size-4 text-neutral-500" aria-hidden="true" />
          <h2 id="potential-conflicts-heading">Potential conflicts</h2>
        </div>
        <p className="mt-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          Conflict detection is currently disabled. Existing decision relationships are unchanged.
        </p>
      </section>
    );
  }

  const open = overview.conflicts.filter((conflict) => conflict.status === "OPEN");
  const historical = overview.conflicts.filter((conflict) => conflict.status !== "OPEN");
  const latestScan = overview.scans[0];

  return (
    <section className="border-t border-neutral-200 pt-6" aria-labelledby="potential-conflicts-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
            <ShieldAlert className="size-4 text-amber-600" aria-hidden="true" />
            <h2 id="potential-conflicts-heading">Potential conflicts</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500">Possible connections between an open PR and earlier engineering decisions.</p>
        </div>
        {latestScan ? <span className="text-xs text-neutral-500">Latest scan: {latestScan.status.toLowerCase()}</span> : null}
      </div>

      {decisionStatus === "PENDING" ? (
        <p className="mt-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          Conflict analysis starts when this decision is approved or rejected.
        </p>
      ) : null}

      {latestScan?.status === "FAILED" ? (
        <div className="mt-3 flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Conflict analysis is unavailable for the latest PR snapshot. No warning was created and merging remains unblocked.</span>
        </div>
      ) : null}

      {open.length ? (
        <div className="mt-4 space-y-3">
          {open.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              canManage={overview.canManage}
              busy={reviewMutation.isPending && reviewMutation.variables?.id === conflict.id}
              onReview={(action) => reviewMutation.mutate({ id: conflict.id, action })}
            />
          ))}
        </div>
      ) : decisionStatus !== "PENDING" && latestScan?.status !== "FAILED" ? (
        <p className="mt-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          No potential conflicts passed the configured evidence and confidence thresholds.
        </p>
      ) : null}

      {historical.length ? (
        <details className="mt-4 rounded-md border border-neutral-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-neutral-700">Previous conflict reviews ({historical.length})</summary>
          <div className="mt-3 space-y-3">
            {historical.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                canManage={false}
                busy={false}
                onReview={() => undefined}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
