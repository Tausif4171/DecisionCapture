export type DecisionStatus = "APPROVED" | "PENDING" | "REJECTED";
export type UserRole = "ADMIN" | "MAINTAINER" | "REVIEWER" | "VIEWER";
export type DecisionAuditAction =
  | "CREATED"
  | "EDITED"
  | "APPROVED"
  | "REJECTED"
  | "REOPENED"
  | "CONTEXT_LINKED"
  | "RELATIONSHIP_SUGGESTED"
  | "RELATIONSHIP_ACCEPTED"
  | "RELATIONSHIP_DISMISSED"
  | "RELATIONSHIP_STALE";
export type DecisionExtractionMethod = "OLLAMA" | "STRUCTURED_FALLBACK" | "UNKNOWN";
export type ContextProvider = "GITHUB" | "LINEAR" | "JIRA" | "GENERIC";
export type ExternalContextType = "ISSUE" | "ADR" | "ARCHITECTURE_DOC" | "MEETING";
export type ExternalContextStatus = "ACTIVE" | "UNAVAILABLE";
export type ContextSyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "UNAVAILABLE";
export type DecisionContextRelationshipType =
  | "RELATED"
  | "ORIGINATED_FROM"
  | "DOCUMENTS"
  | "DISCUSSED_IN";
export type DecisionRelationshipType =
  | "RELATED"
  | "BUILDS_ON"
  | "SUPERSEDES"
  | "POSSIBLE_CONFLICT";
export type DecisionRelationshipStatus = "SUGGESTED" | "ACCEPTED" | "DISMISSED" | "STALE";
export type DecisionRelationshipAnalysisStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type PullRequestState = "OPEN" | "CLOSED";
export type ConflictScanStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type DecisionConflictStatus = "OPEN" | "DISMISSED" | "RESOLVED" | "STALE";
export type ConflictMatchMethod = "LEXICAL" | "EMBEDDING" | "HYBRID";
export type ConflictAuditAction =
  | "DETECTED"
  | "DISMISSED"
  | "RESOLVED"
  | "STALE"
  | "COMMENT_SYNCED"
  | "CHECK_UPDATED";
export type DecisionReviewReason =
  | "MISSING_EXPLANATION"
  | "INCOMPLETE_CONTEXT"
  | "STRUCTURED_FALLBACK"
  | "LOW_CONFIDENCE"
  | "AWAITING_REVIEW"
  | "REVIEW_REOPENED"
  | null;

export interface PRContext {
  prNumber: number;
  title: string;
  description?: string;
  mergedAt?: string;
  author: string;
  url: string;
  repository: string;
  filesChanged: string[];
  commits?: string[];
  reviewers?: string[];
  reviewComments?: string[];
  approvals?: string[];
  labels?: string[];
  diffSummary?: string;
  action?: string;
  state?: PullRequestState;
  draft?: boolean;
  baseBranch?: string;
  headSha?: string;
}

export interface DecisionScore {
  score: number;
  threshold: number;
  shouldAnalyze: boolean;
  categories: string[];
  reasons: string[];
}

export interface ExtractedDecision {
  decision: string;
  reason: string;
  alternative?: string;
  impact?: string | null;
  author: string;
  source: string;
  confidence: number;
  category: string;
  extractionMethod: Exclude<DecisionExtractionMethod, "UNKNOWN">;
}

export interface DecisionMemory {
  id: string;
  decision: string;
  reason: string;
  alternative?: string | null;
  impact?: string | null;
  author: string;
  sourcePR: string;
  repository: string;
  filesChanged: string[];
  confidence: number;
  status: DecisionStatus;
  category: string;
  extractionMethod: DecisionExtractionMethod;
  reviewReason?: DecisionReviewReason;
  prRecordId?: string | null;
  approvedByLogin?: string | null;
  approvedAt?: string | null;
  rejectedByLogin?: string | null;
  rejectedAt?: string | null;
  lastEditedByLogin?: string | null;
  reviewPermissions?: {
    canReview: boolean;
    canReopen: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  githubId: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
}

export interface AuthStatus {
  authMode: "disabled" | "github";
  authenticated: boolean;
  user?: AuthUser;
}

export interface DecisionAuditEntry {
  id: string;
  decisionId: string;
  action: DecisionAuditAction;
  actorLogin?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface ExternalContext {
  id: string;
  provider: ContextProvider;
  type: ExternalContextType;
  providerAccountId: string;
  externalId: string;
  url: string;
  normalizedUrl: string;
  title?: string | null;
  description?: string | null;
  status: ExternalContextStatus;
  metadata?: Record<string, unknown> | null;
  lastSyncedAt?: string | null;
  sync?: {
    status: ContextSyncStatus;
    lastAttemptAt?: string | null;
    lastSuccessAt?: string | null;
    error?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionContextLink {
  id: string;
  decisionId: string;
  externalContextId: string;
  relationshipType: DecisionContextRelationshipType;
  createdByLogin?: string | null;
  createdAt: string;
  updatedAt: string;
  context: ExternalContext;
}

export interface RelatedDecisionSummary {
  id: string;
  decision: string;
  reason: string;
  impact?: string | null;
  category: string;
  repository: string;
  sourcePR: string;
  createdAt: string;
}

export interface DecisionRelationship {
  id: string;
  sourceDecisionId: string;
  targetDecisionId: string;
  type: DecisionRelationshipType;
  status: DecisionRelationshipStatus;
  confidence: number;
  explanation: string;
  evidence: string[];
  analysisVersion: string;
  direction: "OUTGOING" | "INCOMING";
  relatedDecision: RelatedDecisionSummary;
  reviewedByLogin?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRelationshipAnalysis {
  status: DecisionRelationshipAnalysisStatus;
  analysisVersion: string;
  candidateCount: number;
  suggestionCount: number;
  requestedByLogin?: string | null;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  error?: string | null;
  updatedAt: string;
}

export interface DecisionRelationshipOverview {
  enabled: boolean;
  canManage: boolean;
  analysis: DecisionRelationshipAnalysis | null;
  suggestions: DecisionRelationship[];
  confirmed: DecisionRelationship[];
}

export interface DecisionRelationshipAnalysisResponse {
  status: "queued" | "completed" | "already_running";
  analysis: DecisionRelationshipAnalysis;
}

export interface DecisionConflict {
  id: string;
  scanId: string;
  pullRequestRecordId: string;
  decisionId: string;
  repository: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  pullRequestState: PullRequestState;
  headSha: string;
  similarityScore: number;
  confidence: number;
  explanation: string;
  evidence: string[];
  matchMethod: ConflictMatchMethod;
  status: DecisionConflictStatus;
  historicalDecision: {
    id: string;
    decision: string;
    reason: string;
    status: DecisionStatus;
    category: string;
    sourcePR: string;
    repository: string;
    createdAt: string;
  };
  reviewedByLogin?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictScan {
  id: string;
  repository: string;
  prNumber: number;
  headSha: string;
  contentHash: string;
  status: ConflictScanStatus;
  candidateCount: number;
  conflictCount: number;
  error?: string | null;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictOverview {
  enabled: boolean;
  canManage: boolean;
  conflicts: DecisionConflict[];
  scans: ConflictScan[];
}

export interface ConflictScanResponse {
  status: "queued" | "completed" | "already_running";
  scan: ConflictScan;
}

export interface ContextUrlResolution {
  provider: ContextProvider;
  type: ExternalContextType;
  providerAccountId: string;
  externalId: string;
  url: string;
  normalizedUrl: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface GitHubConnectionStatus {
  configured: boolean;
  connected: boolean;
  installationId?: string | null;
  accountLogin?: string | null;
  repositorySelection?: string | null;
  status?: "ACTIVE" | "DISCONNECTED" | "ERROR" | null;
}

export interface GitHubRepositorySummary {
  id: number;
  fullName: string;
  private: boolean;
  url: string;
}

export interface GitHubIssueSummary {
  id: number;
  number: number;
  repository: string;
  title: string;
  state: "open" | "closed";
  url: string;
  authorLogin?: string | null;
  labels: string[];
  updatedAt: string;
}

export interface GitHubIssueCommentSnapshot {
  id: number;
  authorLogin?: string | null;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueContextMetadata {
  owner: string;
  repo: string;
  repository: string;
  issueNumber: number;
  githubIssueId: number;
  nodeId: string;
  state: "open" | "closed";
  stateReason?: string | null;
  authorLogin?: string | null;
  authorAvatarUrl?: string | null;
  labels: Array<{ name: string; color?: string | null }>;
  commentCount: number;
  recentComments: GitHubIssueCommentSnapshot[];
  githubCreatedAt: string;
  githubUpdatedAt: string;
}

export interface PRRecord {
  id: string;
  prNumber: number;
  title: string;
  description?: string | null;
  mergedAt?: string | null;
  author: string;
  url: string;
  repository: string;
  createdAt: string;
}

export interface DecisionListResponse {
  decisions: DecisionMemory[];
  total: number;
}

export interface DecisionStats {
  totalDecisions: number;
  pendingDecisions: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  categories: Array<{ category: string; count: number }>;
  recentDecisions: DecisionMemory[];
}

export interface AnalyzeResponse {
  status: "ignored" | "queued" | "processed";
  score?: DecisionScore;
  decision?: DecisionMemory;
  jobId?: string;
  message: string;
}
