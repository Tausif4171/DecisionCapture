-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MAINTAINER', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DecisionAuditAction" AS ENUM ('CREATED', 'EDITED', 'APPROVED', 'REJECTED', 'REOPENED', 'CONTEXT_LINKED', 'RELATIONSHIP_SUGGESTED', 'RELATIONSHIP_ACCEPTED', 'RELATIONSHIP_DISMISSED', 'RELATIONSHIP_STALE');

-- CreateEnum
CREATE TYPE "DecisionExtractionMethod" AS ENUM ('UNKNOWN', 'OLLAMA', 'STRUCTURED_FALLBACK');

-- CreateEnum
CREATE TYPE "ContextProvider" AS ENUM ('GITHUB', 'LINEAR', 'JIRA', 'GENERIC');

-- CreateEnum
CREATE TYPE "ExternalContextType" AS ENUM ('ISSUE', 'ADR', 'ARCHITECTURE_DOC', 'MEETING');

-- CreateEnum
CREATE TYPE "ExternalContextStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DecisionContextRelationshipType" AS ENUM ('RELATED', 'ORIGINATED_FROM', 'DOCUMENTS', 'DISCUSSED_IN');

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContextSyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DecisionRelationshipType" AS ENUM ('RELATED', 'BUILDS_ON', 'SUPERSEDES', 'POSSIBLE_CONFLICT');

-- CreateEnum
CREATE TYPE "DecisionRelationshipStatus" AS ENUM ('SUGGESTED', 'ACCEPTED', 'DISMISSED', 'STALE');

-- CreateEnum
CREATE TYPE "DecisionRelationshipAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "app_users" (
    "id" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "decision_memories" (
    "id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "alternative" TEXT,
    "impact" TEXT,
    "author" TEXT NOT NULL,
    "sourcePR" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "filesChanged" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "category" TEXT NOT NULL DEFAULT 'architecture',
    "extractionMethod" "DecisionExtractionMethod" NOT NULL DEFAULT 'UNKNOWN',
    "prRecordId" TEXT,
    "approvedByUserId" TEXT,
    "approvedByLogin" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedByLogin" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "lastEditedByLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_audit_logs" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "action" "DecisionAuditAction" NOT NULL,
    "actorUserId" TEXT,
    "actorLogin" TEXT,
    "note" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_contexts" (
    "id" TEXT NOT NULL,
    "provider" "ContextProvider" NOT NULL,
    "type" "ExternalContextType" NOT NULL,
    "providerAccountId" TEXT NOT NULL DEFAULT 'global',
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "status" "ExternalContextStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_context_links" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "externalContextId" TEXT NOT NULL,
    "relationshipType" "DecisionContextRelationshipType" NOT NULL DEFAULT 'RELATED',
    "createdByUserId" TEXT,
    "createdByLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_context_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" TEXT NOT NULL,
    "provider" "ContextProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL DEFAULT 'global',
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "ContextProvider" NOT NULL,
    "externalDeliveryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_syncs" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "status" "ContextSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_relationships" (
    "id" TEXT NOT NULL,
    "sourceDecisionId" TEXT NOT NULL,
    "targetDecisionId" TEXT NOT NULL,
    "type" "DecisionRelationshipType" NOT NULL,
    "status" "DecisionRelationshipStatus" NOT NULL DEFAULT 'SUGGESTED',
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "analysisVersion" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedByLogin" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_relationship_analyses" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" "DecisionRelationshipAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "analysisVersion" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "suggestionCount" INTEGER NOT NULL DEFAULT 0,
    "requestedByLogin" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_relationship_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_githubId_key" ON "app_users"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_login_key" ON "app_users"("login");

-- CreateIndex
CREATE INDEX "app_users_role_idx" ON "app_users"("role");

-- CreateIndex
CREATE INDEX "pr_records_repository_createdAt_idx" ON "pr_records"("repository", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pr_records_repository_prNumber_key" ON "pr_records"("repository", "prNumber");

-- CreateIndex
CREATE INDEX "decision_memories_status_idx" ON "decision_memories"("status");

-- CreateIndex
CREATE INDEX "decision_memories_repository_idx" ON "decision_memories"("repository");

-- CreateIndex
CREATE INDEX "decision_memories_category_idx" ON "decision_memories"("category");

-- CreateIndex
CREATE INDEX "decision_memories_createdAt_idx" ON "decision_memories"("createdAt");

-- CreateIndex
CREATE INDEX "decision_memories_approvedByUserId_idx" ON "decision_memories"("approvedByUserId");

-- CreateIndex
CREATE INDEX "decision_memories_rejectedByUserId_idx" ON "decision_memories"("rejectedByUserId");

-- CreateIndex
CREATE INDEX "decision_memories_lastEditedByUserId_idx" ON "decision_memories"("lastEditedByUserId");

-- CreateIndex
CREATE INDEX "decision_audit_logs_decisionId_idx" ON "decision_audit_logs"("decisionId");

-- CreateIndex
CREATE INDEX "decision_audit_logs_actorUserId_idx" ON "decision_audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "decision_audit_logs_action_idx" ON "decision_audit_logs"("action");

-- CreateIndex
CREATE INDEX "decision_audit_logs_createdAt_idx" ON "decision_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "external_contexts_provider_type_idx" ON "external_contexts"("provider", "type");

-- CreateIndex
CREATE INDEX "external_contexts_status_idx" ON "external_contexts"("status");

-- CreateIndex
CREATE INDEX "external_contexts_normalizedUrl_idx" ON "external_contexts"("normalizedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "external_contexts_provider_providerAccountId_externalId_key" ON "external_contexts"("provider", "providerAccountId", "externalId");

-- CreateIndex
CREATE INDEX "decision_context_links_externalContextId_idx" ON "decision_context_links"("externalContextId");

-- CreateIndex
CREATE INDEX "decision_context_links_createdByUserId_idx" ON "decision_context_links"("createdByUserId");

-- CreateIndex
CREATE INDEX "decision_context_links_relationshipType_idx" ON "decision_context_links"("relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "decision_context_links_decisionId_externalContextId_key" ON "decision_context_links"("decisionId", "externalContextId");

-- CreateIndex
CREATE INDEX "provider_connections_status_idx" ON "provider_connections"("status");

-- CreateIndex
CREATE INDEX "provider_connections_createdByUserId_idx" ON "provider_connections"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_provider_providerAccountId_key" ON "provider_connections"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_externalDeliveryId_key" ON "webhook_events"("provider", "externalDeliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "context_syncs_contextId_key" ON "context_syncs"("contextId");

-- CreateIndex
CREATE INDEX "context_syncs_status_idx" ON "context_syncs"("status");

-- CreateIndex
CREATE INDEX "decision_relationships_targetDecisionId_idx" ON "decision_relationships"("targetDecisionId");

-- CreateIndex
CREATE INDEX "decision_relationships_status_idx" ON "decision_relationships"("status");

-- CreateIndex
CREATE INDEX "decision_relationships_type_idx" ON "decision_relationships"("type");

-- CreateIndex
CREATE INDEX "decision_relationships_reviewedByUserId_idx" ON "decision_relationships"("reviewedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_relationships_sourceDecisionId_targetDecisionId_key" ON "decision_relationships"("sourceDecisionId", "targetDecisionId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_relationship_analyses_decisionId_key" ON "decision_relationship_analyses"("decisionId");

-- CreateIndex
CREATE INDEX "decision_relationship_analyses_status_idx" ON "decision_relationship_analyses"("status");

-- AddForeignKey
ALTER TABLE "decision_memories" ADD CONSTRAINT "decision_memories_prRecordId_fkey" FOREIGN KEY ("prRecordId") REFERENCES "pr_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_memories" ADD CONSTRAINT "decision_memories_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_memories" ADD CONSTRAINT "decision_memories_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_memories" ADD CONSTRAINT "decision_memories_lastEditedByUserId_fkey" FOREIGN KEY ("lastEditedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_audit_logs" ADD CONSTRAINT "decision_audit_logs_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_audit_logs" ADD CONSTRAINT "decision_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_context_links" ADD CONSTRAINT "decision_context_links_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_context_links" ADD CONSTRAINT "decision_context_links_externalContextId_fkey" FOREIGN KEY ("externalContextId") REFERENCES "external_contexts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_context_links" ADD CONSTRAINT "decision_context_links_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_syncs" ADD CONSTRAINT "context_syncs_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "external_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_relationships" ADD CONSTRAINT "decision_relationships_sourceDecisionId_fkey" FOREIGN KEY ("sourceDecisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_relationships" ADD CONSTRAINT "decision_relationships_targetDecisionId_fkey" FOREIGN KEY ("targetDecisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_relationships" ADD CONSTRAINT "decision_relationships_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_relationship_analyses" ADD CONSTRAINT "decision_relationship_analyses_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decision_memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
