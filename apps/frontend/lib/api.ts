import type {
  AnalyzeResponse,
  DecisionListResponse,
  DecisionMemory,
  DecisionStats
} from "@decisioncapture/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Query = Record<string, string | number | undefined>;

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed with ${response.status}`, response.status);
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

export function approveDecision(id: string, body: Partial<DecisionMemory>) {
  return request<DecisionMemory>(`/decisions/${id}/approve`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: body.decision,
      reason: body.reason,
      alternative: body.alternative,
      impact: body.impact
    })
  });
}

export function rejectDecision(id: string) {
  return request<DecisionMemory>(`/decisions/${id}/reject`, {
    method: "PATCH"
  });
}

export function createDemoPr() {
  return request<AnalyzeResponse>("/demo/pr", {
    method: "POST"
  });
}
