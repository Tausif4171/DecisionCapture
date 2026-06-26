import type { DecisionMemory } from "@decisioncapture/shared";
import { AlertTriangle, CheckCircle2, FileQuestion, PencilLine, Sparkles } from "lucide-react";

const reasonConfig = {
  MISSING_EXPLANATION: {
    icon: FileQuestion,
    label: "Missing explanation",
    description: "The PR was meaningful, but the source context did not clearly explain why this approach was chosen."
  },
  STRUCTURED_FALLBACK: {
    icon: Sparkles,
    label: "Fallback extraction",
    description: "Ollama was unavailable or returned unusable output, so DecisionCapture used explicit PR sections only."
  },
  LOW_CONFIDENCE: {
    icon: AlertTriangle,
    label: "Low confidence",
    description: "The capture looks useful, but confidence is below the automatic approval threshold."
  },
  AWAITING_REVIEW: {
    icon: PencilLine,
    label: "Draft saved",
    description: "A reviewer edited this memory. It stays pending until it is approved or rejected."
  }
};

export function reviewReasonLabel(decision: DecisionMemory) {
  return decision.reviewReason ? reasonConfig[decision.reviewReason]?.label : null;
}

export function ReviewReasonCallout({ decision }: { decision: DecisionMemory }) {
  const config = decision.reviewReason ? reasonConfig[decision.reviewReason] : null;

  if (!config || decision.status !== "PENDING") {
    return null;
  }

  const Icon = config.icon;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{config.label}</p>
          <p className="mt-0.5 text-amber-800">{config.description}</p>
        </div>
      </div>
    </div>
  );
}

export function ReviewSummary({ decision }: { decision: DecisionMemory }) {
  if (decision.status === "APPROVED" && decision.approvedByLogin) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Reviewed by {decision.approvedByLogin}
      </span>
    );
  }

  if (decision.status === "REJECTED" && decision.rejectedByLogin) {
    return <span className="text-xs text-neutral-500">Rejected by {decision.rejectedByLogin}</span>;
  }

  const label = reviewReasonLabel(decision);
  return label ? <span className="text-xs text-amber-700">{label}</span> : null;
}

