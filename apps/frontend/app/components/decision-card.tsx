import Link from "next/link";
import type { DecisionMemory } from "@decisioncapture/shared";
import { ArrowUpRight, GitBranch, UserRound } from "lucide-react";
import { ReviewSummary } from "./review-reason";
import { StatusBadge } from "./status-badge";

export function DecisionCard({ decision }: { decision: DecisionMemory }) {
  return (
    <article className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={decision.status} />
            <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
              {decision.category}
            </span>
            <span className="text-xs text-neutral-500">{Math.round(decision.confidence * 100)}% confidence</span>
            <ReviewSummary decision={decision} />
          </div>
          <h3 className="text-base font-semibold text-neutral-950">{decision.decision}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-600">{decision.reason}</p>
        </div>
        <Link
          href={`/decisions/${decision.id}`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
          title="Open decision"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" />
          Open
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3.5" aria-hidden="true" />
          {decision.repository} {decision.sourcePR}
        </span>
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3.5" aria-hidden="true" />
          {decision.author}
        </span>
      </div>
    </article>
  );
}
