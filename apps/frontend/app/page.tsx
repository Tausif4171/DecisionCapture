"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, Clock3, Database, GitPullRequestArrow, XCircle } from "lucide-react";
import { getStats } from "../lib/api";
import { DecisionCard } from "./components/decision-card";
import { EmptyState, ErrorState, LoadingState } from "./components/state-views";

const metricIcons = {
  total: Database,
  approved: CheckCircle2,
  pending: Clock3,
  rejected: XCircle
};

export default function DashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: getStats
  });

  if (statsQuery.isLoading) {
    return <LoadingState label="Loading dashboard" />;
  }

  if (statsQuery.error) {
    return <ErrorState message={statsQuery.error.message} />;
  }

  const stats = statsQuery.data;
  const total = stats?.totalDecisions ?? 0;
  const pending = stats?.pendingDecisions ?? 0;
  const approved = stats?.approvedDecisions ?? 0;
  const reviewRate = total > 0 ? Math.round((approved / total) * 100) : 0;
  const metrics = [
    { label: "Total decisions", value: total, icon: metricIcons.total },
    { label: "Approved", value: approved, icon: metricIcons.approved },
    { label: "Pending review", value: pending, icon: metricIcons.pending },
    { label: "Rejected", value: stats?.rejectedDecisions ?? 0, icon: metricIcons.rejected }
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Merged PR memory</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-950">Decision overview</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            Track captured engineering decisions, review work, and team memory by category.
          </p>
        </div>
        <Link
          href="/pending"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-neutral-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
        >
          Review queue
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-500">{metric.label}</p>
              <metric.icon className="size-4 text-neutral-400" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-neutral-950">{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950">Review progress</h2>
            <p className="mt-1 text-sm text-neutral-600">
              {pending > 0
                ? `${pending} ${pending === 1 ? "decision needs" : "decisions need"} human confirmation before ${pending === 1 ? "it becomes" : "they become"} permanent memory.`
                : "No decisions need review. Approved memories are ready for search."}
            </p>
          </div>
          <div className="min-w-48">
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
              <span>Approved share</span>
              <span>{reviewRate}%</span>
            </div>
            <div className="h-2 rounded-md bg-neutral-100">
              <div className="h-2 rounded-md bg-emerald-500" style={{ width: `${reviewRate}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-950">Recent decisions</h2>
            <Link
              href="/decisions"
              className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700 hover:text-neutral-950"
            >
              View all
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {stats?.recentDecisions.length ? (
            <div className="space-y-3">
              {stats.recentDecisions.map((decision) => (
                <DecisionCard key={decision.id} decision={decision} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No decisions captured yet"
              description="Merge a meaningful PR or send a merged PR payload to start building the memory layer."
            />
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-950">Categories</h2>
          <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
            {stats?.categories.length ? (
              <div className="space-y-3">
                {stats.categories.map((category) => (
                  <div key={category.category}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-neutral-700">{category.category}</span>
                      <span className="text-neutral-500">{category.count}</span>
                    </div>
                    <div className="h-2 rounded-md bg-neutral-100">
                      <div
                        className="h-2 rounded-md bg-emerald-500"
                        style={{
                          width: `${Math.max(8, (category.count / Math.max(1, stats.totalDecisions)) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <GitPullRequestArrow className="mx-auto mb-3 size-5 text-neutral-400" aria-hidden="true" />
                <p className="text-sm text-neutral-500">Categories appear after the first captured decision.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
