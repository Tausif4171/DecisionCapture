"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Filter, Search, X } from "lucide-react";
import { listDecisions } from "../../lib/api";
import { DecisionCard } from "../components/decision-card";
import { EmptyState, ErrorState, LoadingState } from "../components/state-views";

export default function DecisionsPage() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const decisionsQuery = useQuery({
    queryKey: ["decisions", { search, status, sort, page }],
    queryFn: () =>
      listDecisions({
        q: search,
        status,
        sort,
        limit: pageSize,
        offset: page * pageSize
      })
  });

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setSearch(draftSearch);
  }

  function clearFilters() {
    setDraftSearch("");
    setSearch("");
    setStatus("");
    setSort("recent");
    setPage(0);
  }

  const total = decisionsQuery.data?.total ?? 0;
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const hasNextPage = end < total;

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-semibold text-neutral-950">Decision memory</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
          Search by reason, source PR, author, repository, or the exact question an engineer might ask later.
        </p>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]" onSubmit={submitSearch}>
          <label className="relative">
            <span className="sr-only">Search decisions</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Why Redis? Who changed auth?"
              className="min-h-10 w-full rounded-md border border-neutral-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-neutral-400"
            />
          </label>
          <label>
            <span className="sr-only">Filter status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
              className="min-h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-400"
            >
              <option value="">All statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort decisions</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(0);
              }}
              className="min-h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-400"
            >
              <option value="recent">Recent</option>
              <option value="confidence">Confidence</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
            title="Apply search"
          >
            <Filter className="size-4" aria-hidden="true" />
            Apply
          </button>
        </form>
        {search || status || sort !== "recent" ? (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 inline-flex min-h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </button>
        ) : null}
      </section>

      {decisionsQuery.isLoading ? <LoadingState label="Searching decisions" /> : null}
      {decisionsQuery.error ? <ErrorState message={decisionsQuery.error.message} /> : null}
      {decisionsQuery.data && decisionsQuery.data.decisions.length === 0 ? (
        <EmptyState title="No matching decisions" description="Adjust the search, status, or sort controls." />
      ) : null}
      {decisionsQuery.data?.decisions.length ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-neutral-500">
              Showing {start}-{end} of {total} decisions
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!hasNextPage}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
              >
                Next
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {decisionsQuery.data.decisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
