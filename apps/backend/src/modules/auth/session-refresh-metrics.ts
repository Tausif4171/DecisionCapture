export type SessionRefreshMetric = {
  activeRefreshes: number;
  queuedRequests: number;
  reusedToken: boolean;
};

export function formatSessionRefreshMetric(metric: SessionRefreshMetric) {
  const mode = metric.reusedToken ? "reused-token" : "new-refresh";
  return `${mode}:${metric.activeRefreshes}:${metric.queuedRequests}`;
}