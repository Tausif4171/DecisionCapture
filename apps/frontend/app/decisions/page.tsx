"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Search, X } from "lucide-react";
import { listDecisions } from "../../lib/api";
import { DecisionCard } from "../components/decision-card";
import { useProtectedPageAccess } from "../components/protected-page-access";
import { SelectMenu } from "../components/select-menu";
import {
  EmptyState,
  ErrorState,
  isAuthRequiredMessage,
  LoadingState
} from "../components/state-views";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "APPROVED", label: "Approved" },
  { value: "PENDING", label: "Pending" },
  { value: "REJECTED", label: "Rejected" }
];
const SORT_OPTIONS = [
  { value: "recent", label: "Newest first" },
  { value: "confidence", label: "Highest confidence" },
  { value: "oldest", label: "Oldest first" }
];

function DecisionsPageContent() {
  const access = useProtectedPageAccess();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.get("q")?.trim() ?? "";
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "APPROVED" || statusParam === "PENDING" || statusParam === "REJECTED"
      ? statusParam
      : "";
  const sortParam = searchParams.get("sort");
  const sort = sortParam === "confidence" || sortParam === "oldest" ? sortParam : "recent";
  const requestedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageNumber = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const page = pageNumber - 1;
  const [draftSearch, setDraftSearch] = useState(search);
  const [lastSearch, setLastSearch] = useState(search);

  if (lastSearch !== search) {
    setLastSearch(search);
    setDraftSearch(search);
  }

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          nextParams.set(key, value);
        } else {
          nextParams.delete(key);
        }
      });

      const queryString = nextParams.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const normalizedDraft = draftSearch.trim();

    if (normalizedDraft === search) {
      return;
    }

    const timer = window.setTimeout(() => {
      updateParams({ q: normalizedDraft || null, page: null });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draftSearch, search, updateParams]);

  const decisionsQuery = useQuery({
    queryKey: ["decisions", { search, status, sort, page }],
    queryFn: () =>
      listDecisions({
        q: search,
        status,
        sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      }),
    placeholderData: keepPreviousData,
    enabled: access.canLoadProtectedData
  });

  if (access.gate) {
    return access.gate;
  }

  if (decisionsQuery.error && isAuthRequiredMessage(decisionsQuery.error.message)) {
    return <ErrorState message={decisionsQuery.error.message} />;
  }

  function submitSearch() {
    updateParams({ q: draftSearch.trim() || null, page: null });
  }

  function clearSearch() {
    setDraftSearch("");
    updateParams({ q: null, page: null });
  }

  function clearFilters() {
    setDraftSearch("");
    router.replace(pathname, { scroll: false });
  }

  const total = decisionsQuery.data?.total ?? 0;
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasNextPage = end < total;

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-semibold text-neutral-950">Decision memory</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
          Search decisions by rationale, repository, author, or source PR.
        </p>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
        <form
          className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_210px]"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <label className="relative">
            <span className="sr-only">Search decisions</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Search decisions..."
              className="min-h-10 w-full rounded-md border border-neutral-200 bg-white pl-9 pr-10 text-sm outline-none transition focus:border-neutral-400"
            />
            {draftSearch ? (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <SelectMenu
            label="Filter status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(nextStatus) => updateParams({ status: nextStatus || null, page: null })}
          />
          <SelectMenu
            label="Sort decisions"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(nextSort) =>
              updateParams({
                sort: nextSort === "recent" ? null : nextSort,
                page: null
              })
            }
          />
        </form>
        {draftSearch || search || status || sort !== "recent" ? (
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

      {decisionsQuery.isLoading ? <LoadingState label="Loading decisions" /> : null}
      {decisionsQuery.error ? <ErrorState message={decisionsQuery.error.message} /> : null}
      {decisionsQuery.data && decisionsQuery.data.decisions.length === 0 ? (
        <EmptyState title="No matching decisions" description="Try a different search or status filter." />
      ) : null}
      {decisionsQuery.data?.decisions.length ? (
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-neutral-500" aria-live="polite">
              Showing {start}-{end} of {total} decisions
              {decisionsQuery.isFetching ? " - Updating..." : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  updateParams({ page: pageNumber <= 2 ? null : String(pageNumber - 1) })
                }
                disabled={pageNumber === 1}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => updateParams({ page: String(pageNumber + 1) })}
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

export default function DecisionsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading decisions" />}>
      <DecisionsPageContent />
    </Suspense>
  );
}
