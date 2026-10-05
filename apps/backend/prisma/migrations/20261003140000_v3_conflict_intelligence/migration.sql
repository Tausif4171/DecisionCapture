CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ConflictScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "DecisionConflictStatus" AS ENUM ('OPEN', 'DISMISSED', 'RESOLVED', 'STALE');
CREATE TYPE "ConflictMatchMethod" AS ENUM ('LEXICAL', 'EMBEDDING', 'HYBRID');
CREATE TYPE "ConflictAuditAction" AS ENUM ('DETECTED', 'DISMISSED', 'RESOLVED', 'STALE', 'COMMENT_SYNCED', 'CHECK_UPDATED');

ALTER TABLE "pr_records"
  ADD COLUMN "state" "PullRequestState" NOT NULL DEFAULT 'CLOSED',
  ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "baseBranch" TEXT,
  ADD COLUMN "headSha" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "lastConflictScanAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "pr_records_repository_state_idx" ON "pr_records"("repository", "state");
CREATE INDEX "pr_records_repository_headSha_idx" ON "pr_records"("repository", "headSha");

CREATE TABLE "conflict_scans" (
  "id" TEXT NOT NULL,
  "pullRequestRecordId" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "prNumber" INTEGER NOT NULL,
  "headSha" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" "ConflictScanStatus" NOT NULL DEFAULT 'PENDING',
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conflict_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conflict_scans_repository_prNumber_headSha_contentHash_key"
  ON "conflict_scans"("repository", "prNumber", "headSha", "contentHash");
CREATE INDEX "conflict_scans_repository_prNumber_status_idx"
  ON "conflict_scans"("repository", "prNumber", "status");
CREATE INDEX "conflict_scans_pullRequestRecordId_idx" ON "conflict_scans"("pullRequestRecordId");
CREATE INDEX "conflict_scans_headSha_idx" ON "conflict_scans"("headSha");

CREATE TABLE "decision_conflicts" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "pullRequestRecordId" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "prNumber" INTEGER NOT NULL,
  "prUrl" TEXT NOT NULL,
  "prTitle" TEXT NOT NULL,
  "headSha" TEXT NOT NULL,
  "similarityScore" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "explanation" TEXT NOT NULL,
  "evidence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "matchMethod" "ConflictMatchMethod" NOT NULL,
  "status" "DecisionConflictStatus" NOT NULL DEFAULT 'OPEN',
  "reviewedByUserId" TEXT,
  "reviewedByLogin" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "decision_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_conflicts_scanId_decisionId_key" ON "decision_conflicts"("scanId", "decisionId");
CREATE INDEX "decision_conflicts_repository_prNumber_status_idx" ON "decision_conflicts"("repository", "prNumber", "status");
CREATE INDEX "decision_conflicts_decisionId_status_idx" ON "decision_conflicts"("decisionId", "status");
CREATE INDEX "decision_conflicts_pullRequestRecordId_status_idx" ON "decision_conflicts"("pullRequestRecordId", "status");
CREATE INDEX "decision_conflicts_headSha_idx" ON "decision_conflicts"("headSha");

CREATE TABLE "conflict_audit_logs" (
  "id" TEXT NOT NULL,
  "conflictId" TEXT NOT NULL,
  "action" "ConflictAuditAction" NOT NULL,
  "actorUserId" TEXT,
  "actorLogin" TEXT,
  "note" TEXT,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conflict_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conflict_audit_logs_conflictId_idx" ON "conflict_audit_logs"("conflictId");
CREATE INDEX "conflict_audit_logs_actorUserId_idx" ON "conflict_audit_logs"("actorUserId");
CREATE INDEX "conflict_audit_logs_action_idx" ON "conflict_audit_logs"("action");
CREATE INDEX "conflict_audit_logs_createdAt_idx" ON "conflict_audit_logs"("createdAt");

CREATE TABLE "decision_embeddings" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "textHash" TEXT NOT NULL,
  "embedding" vector(768) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "decision_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_embeddings_decisionId_model_textHash_key"
  ON "decision_embeddings"("decisionId", "model", "textHash");
CREATE INDEX "decision_embeddings_decisionId_model_idx" ON "decision_embeddings"("decisionId", "model");
CREATE INDEX "decision_embeddings_embedding_ivfflat_idx"
  ON "decision_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

ALTER TABLE "conflict_scans"
  ADD CONSTRAINT "conflict_scans_pullRequestRecordId_fkey"
  FOREIGN KEY ("pullRequestRecordId") REFERENCES "pr_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decision_conflicts"
  ADD CONSTRAINT "decision_conflicts_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "conflict_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_conflicts_pullRequestRecordId_fkey"
  FOREIGN KEY ("pullRequestRecordId") REFERENCES "pr_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_conflicts_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "decision_conflicts_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conflict_audit_logs"
  ADD CONSTRAINT "conflict_audit_logs_conflictId_fkey"
  FOREIGN KEY ("conflictId") REFERENCES "decision_conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conflict_audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decision_embeddings"
  ADD CONSTRAINT "decision_embeddings_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
