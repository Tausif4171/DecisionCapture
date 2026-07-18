import type {
  AnalyzeResponse,
  AuthStatus,
  DecisionAuditEntry,
  DecisionListResponse,
  DecisionMemory,
  DecisionStats
} from "@decisioncapture/shared";
import type { DecisionReviewDraft } from "./decision-review";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const defaultApiUrl = process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000";

type Query = Record<string, string | number | undefined>;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function normalizeApiUrl(value: string) {
  return value.replace(/\/+$/, "") || "/";
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function frontendHostname() {
  if (typeof window !== "undefined") {
    return window.location.hostname.toLowerCase();
  }

  return (process.env.VERCEL_URL ?? "").toLowerCase();
}

function apiBaseUrl() {
  const apiUrl = normalizeApiUrl(configuredApiUrl || defaultApiUrl);
  const hostname = frontendHostname();
  const isVercelFrontend = hostname === "vercel.app" || hostname.endsWith(".vercel.app");

  if (isVercelFrontend && isAbsoluteHttpUrl(apiUrl)) {
    return "/api";
  }

  return apiUrl;
}

function apiUrl(path: string) {
  return `${apiBaseUrl()}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed with ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function toSearchParams(query: Query) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export function getStats() {
  return request<DecisionStats>("/decisions/stats");
}

export function listDecisions(query: Query = {}) {
  return request<DecisionListResponse>(`/decisions${toSearchParams(query)}`);
}

export function getDecision(id: string) {
  return request<DecisionMemory>(`/decisions/${id}`);
}

export function listDecisionAudit(id: string) {
  return request<DecisionAuditEntry[]>(`/decisions/${id}/audit`);
}

export function getAuthStatus() {
  return request<AuthStatus>("/auth/me");
}

export function authLoginUrl(returnTo: string) {
  return `${apiBaseUrl()}/auth/github?returnTo=${encodeURIComponent(returnTo)}`;
}

export function logout() {
  return request<void>("/auth/logout", {
    method: "POST"
  });
}

function toDecisionReviewBody(body: DecisionReviewDraft) {
  return {
    decision: body.decision,
    reason: body.reason,
    alternative: body.alternative,
    impact: body.impact
  };
}

export function updateDecision(id: string, body: DecisionReviewDraft) {
  return request<DecisionMemory>(`/decisions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(toDecisionReviewBody(body))
  });
}

export function approveDecision(id: string, body: DecisionReviewDraft) {
  return request<DecisionMemory>(`/decisions/${id}/approve`, {
    method: "PATCH",
    body: JSON.stringify(toDecisionReviewBody(body))
  });
}

export function rejectDecision(id: string) {
  return request<DecisionMemory>(`/decisions/${id}/reject`, {
    method: "PATCH"
  });
}

export function reopenDecision(id: string, reason: string) {
  return request<DecisionMemory>(`/decisions/${id}/reopen`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function createDemoPr() {
  return request<AnalyzeResponse>("/demo/pr", {
    method: "POST"
  });
}
