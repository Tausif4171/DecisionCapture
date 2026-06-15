import type { DecisionStatus } from "@decisioncapture/shared";

const styles: Record<DecisionStatus, string> = {
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  REJECTED: "border-neutral-200 bg-neutral-100 text-neutral-600"
};

export function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
