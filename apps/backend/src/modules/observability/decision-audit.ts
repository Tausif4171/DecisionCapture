export type DecisionAuditEvent = {
  source: "github-webhook" | "github-action" | "manual-demo";
  repository: string;
  prNumber: number;
  category: "api" | "architecture" | "infrastructure";
  reason: string;
};

export function formatDecisionAuditEvent(event: DecisionAuditEvent) {
  return `${event.source}:${event.repository}#${event.prNumber}:${event.category}:${event.reason}`;
}