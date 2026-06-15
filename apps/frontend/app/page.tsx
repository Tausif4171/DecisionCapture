"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, Clock3, Database, GitPullRequestArrow, XCircle } from "lucide-react";
import { getStats } from "../lib/api";
import { DecisionCard } from "./components/decision-card";
import { DemoButton } from "./components/demo-button";
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
  const metrics = [
    { label: "Total decisions", value: stats?.totalDecisions ?? 0, icon: metricIcons.total },
    { label: "Approved", value: stats?.approvedDecisions ?? 0, icon: metricIcons.approved },
    { label: "Pending", value: stats?.pendingDecisions ?? 0, icon: metricIcons.pending },
    { label: "Rejected", value: stats?.rejectedDecisions ?? 0, icon: metricIcons.rejected }
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700">Merged PR memory</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-950">Engineering decisions that stay findable</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
            DecisionCapture scores merged pull requests, extracts the reason behind meaningful technical changes, and keeps low-confidence memories in review.
          </p>
        </div>
        <DemoButton />
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
              description="Run the demo PR or send a merged PR payload to start building the memory layer."
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
