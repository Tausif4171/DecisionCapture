import type {
  ConflictMatchMethod,
  DecisionConflictStatus,
  DecisionStatus,
  PRContext
} from "@decisioncapture/shared";

export type ConflictPullRequestContext = PRContext & {
  action: string;
  state: "OPEN" | "CLOSED";
  draft: boolean;
  headSha: string;
};

export type ConflictCandidate = {
  id: string;
  decision: string;
  reason: string;
  alternative?: string | null;
  impact: string;
  status: DecisionStatus;
  category: string;
  repository: string;
  sourcePR: string;
  filesChanged: string[];
  createdAt: string;
  similarityScore?: number;
  matchMethod?: ConflictMatchMethod;
};

export type ConflictAssessment = {
  decisionId: string;
  conflict: boolean;
  confidence: number;
  explanation: string;
  evidenceFromPr: string[];
  evidenceFromDecision: string[];
};

export interface ConflictAnalyzer {
  analyze(
    context: ConflictPullRequestContext,
    candidates: ConflictCandidate[]
  ): Promise<ConflictAssessment[]>;
}

export type ConflictReviewAction = "dismiss" | "resolve";

export type ConflictRecord = {
  id: string;
  scanId: string;
  pullRequestRecordId: string;
  decisionId: string;
  repository: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  headSha: string;
  similarityScore: number;
  confidence: number;
  explanation: string;
  evidence: string[];
  matchMethod: ConflictMatchMethod;
  status: DecisionConflictStatus;
  historicalDecision: ConflictCandidate;
  reviewedByLogin?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
};
