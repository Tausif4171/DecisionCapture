CREATE TYPE "DecisionStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

CREATE TABLE "pr_records" (
  "id" TEXT NOT NULL,
  "prNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "mergedAt" TIMESTAMP(3),
  "author" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "sourcePayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pr_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_memories" (
  "id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "alternative" TEXT,
  "impact" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "sourcePR" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "filesChanged" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "confidence" DOUBLE PRECISION NOT NULL,
  "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
  "category" TEXT NOT NULL DEFAULT 'architecture',
  "prRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "decision_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pr_records_repository_prNumber_key" ON "pr_records"("repository", "prNumber");
CREATE INDEX "pr_records_repository_idx" ON "pr_records"("repository");
CREATE INDEX "decision_memories_status_idx" ON "decision_memories"("status");
CREATE INDEX "decision_memories_repository_idx" ON "decision_memories"("repository");
CREATE INDEX "decision_memories_category_idx" ON "decision_memories"("category");
CREATE INDEX "decision_memories_createdAt_idx" ON "decision_memories"("createdAt");

ALTER TABLE "decision_memories"
  ADD CONSTRAINT "decision_memories_prRecordId_fkey"
  FOREIGN KEY ("prRecordId") REFERENCES "pr_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
