export type DecisionSearchOptions = {
  q?: string;
  status?: "APPROVED" | "PENDING" | "REJECTED";
  repository?: string;
  category?: string;
  sort?: "recent" | "confidence" | "oldest";
  limit?: number;
  offset?: number;
};

export type DecisionReviewUpdates = {
  decision?: string;
  reason?: string;
  alternative?: string | null;
  impact?: string;
};

export type DecisionReopenInput = {
  reason: string;
};

export type DecisionRejectInput = {
  reason?: string;
};
