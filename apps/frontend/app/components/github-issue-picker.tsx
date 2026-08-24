"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Github, Loader2, RefreshCw, Search } from "lucide-react";
import {
  connectGitHub,
  getGitHubConnection,
  listGitHubIssues,
  listGitHubRepositories
} from "../../lib/api";
import { SelectMenu } from "./select-menu";

type GitHubIssuePickerProps = {
  defaultRepository: string;
  canManageIntegration: boolean;
  disabled: boolean;
  onSelect: (url: string) => void;
};

export function GitHubIssuePicker({
  defaultRepository,
  canManageIntegration,
  disabled,
  onSelect
}: GitHubIssuePickerProps) {
  const queryClient = useQueryClient();
  const [selectedRepository, setSelectedRepository] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedIssueUrl, setSelectedIssueUrl] = useState("");
  const connectionQuery = useQuery({
    queryKey: ["github-context-connection"],
    queryFn: getGitHubConnection
  });
  const connected = Boolean(connectionQuery.data?.connected);
  const repositoriesQuery = useQuery({
    queryKey: ["github-context-repositories"],
    queryFn: listGitHubRepositories,
    enabled: connected && canManageIntegration
  });
  const connectMutation = useMutation({
    mutationFn: connectGitHub,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["github-context-connection"] });
      await queryClient.invalidateQueries({ queryKey: ["github-context-repositories"] });
    }
  });

  const repositories = repositoriesQuery.data ?? [];
  const defaultRepositoryOption =
    repositories.find(
      (candidate) => candidate.fullName.toLowerCase() === defaultRepository.toLowerCase()
    ) ?? repositories[0];
  const repository = selectedRepository || defaultRepositoryOption?.fullName || "";
  const issuesQuery = useQuery({
    queryKey: ["github-context-issues", repository, appliedSearch],
    queryFn: () => listGitHubIssues(repository, appliedSearch),
    enabled: connected && canManageIntegration && Boolean(repository)
  });
  const issues = issuesQuery.data ?? [];

  if (connectionQuery.isLoading) {
    return <p className="text-xs text-neutral-500">Checking GitHub connection...</p>;
  }

  if (!connectionQuery.data?.configured) {
    return <p className="text-xs text-neutral-500">GitHub App is not configured.</p>;
  }

  if (!connected) {
    return canManageIntegration ? (
      <div>
        <button
          type="button"
          onClick={() => connectMutation.mutate()}
          disabled={connectMutation.isPending || disabled}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-neutral-200 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
          title="Connect configured GitHub App"
        >
          {connectMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Github className="size-4" aria-hidden="true" />
          )}
          {connectMutation.isPending ? "Connecting..." : "Connect GitHub"}
        </button>
        {connectMutation.error instanceof Error ? (
          <p className="mt-2 text-xs text-red-600">{connectMutation.error.message}</p>
        ) : null}
      </div>
    ) : (
      <p className="text-xs text-neutral-500">GitHub issue selection is not connected.</p>
    );
  }

  if (!canManageIntegration) {
    return <p className="text-xs text-neutral-500">Paste a GitHub issue URL below.</p>;
  }

  if (repositoriesQuery.isLoading) {
    return <p className="text-xs text-neutral-500">Loading GitHub repositories...</p>;
  }

  if (repositoriesQuery.error instanceof Error) {
    return <p className="text-xs text-red-600">{repositoriesQuery.error.message}</p>;
  }

  if (repositories.length === 0) {
    return <p className="text-xs text-neutral-500">No repositories are available to this installation.</p>;
  }

  return (
    <div className="space-y-2 border-b border-neutral-100 pb-3">
      <SelectMenu
        label="GitHub repository"
        value={repository}
        options={repositories.map((candidate) => ({
          value: candidate.fullName,
          label: candidate.fullName
        }))}
        onChange={(value) => {
          setSelectedRepository(value);
          setSelectedIssueUrl("");
        }}
      />
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search GitHub issues</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setAppliedSearch(search.trim());
              }
            }}
            placeholder="Search title or issue number"
            className="min-h-10 w-full rounded-md border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400"
          />
        </label>
        <button
          type="button"
          onClick={() => setAppliedSearch(search.trim())}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          title="Search GitHub issues"
          aria-label="Search GitHub issues"
        >
          <Search className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => issuesQuery.refetch()}
          disabled={issuesQuery.isFetching}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:text-neutral-300"
          title="Refresh GitHub issues"
          aria-label="Refresh GitHub issues"
        >
          <RefreshCw className={`size-4 ${issuesQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {issuesQuery.isLoading ? (
        <p className="text-xs text-neutral-500">Loading GitHub issues...</p>
      ) : issuesQuery.error instanceof Error ? (
        <p className="text-xs text-red-600">{issuesQuery.error.message}</p>
      ) : issues.length ? (
        <SelectMenu
          label="GitHub issue"
          value={selectedIssueUrl}
          options={issues.map((issue) => ({
            value: issue.url,
            label: `#${issue.number} ${issue.title}`
          }))}
          onChange={(value) => {
            setSelectedIssueUrl(value);
            onSelect(value);
          }}
        />
      ) : (
        <p className="text-xs text-neutral-500">No matching GitHub issues.</p>
      )}
    </div>
  );
}
