-- NOTE: This migration is an exact duplicate of 20260202190239_add_message_review_samples.
-- It was rewritten to be idempotent so it is a no-op on databases where the earlier
-- migration already created these objects. Original preserved as migration.sql.orig.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewVerdict') THEN
        CREATE TYPE "ReviewVerdict" AS ENUM ('GOOD', 'NEEDS_IMPROVEMENT', 'UNSAFE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SampledReason') THEN
        CREATE TYPE "SampledReason" AS ENUM ('EDITED', 'HIGH_RISK', 'RANDOM');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "message_review_samples" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "conversationId" TEXT,
    "candidateId" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampledReason" "SampledReason" NOT NULL,
    "proposedText" TEXT NOT NULL,
    "finalText" TEXT NOT NULL,
    "editMetrics" JSONB NOT NULL,
    "verdict" "ReviewVerdict",
    "reviewedAt" TIMESTAMP(3),
    "reviewedByOperatorId" TEXT,
    "notes" TEXT,
    CONSTRAINT "message_review_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_review_samples_agencyId_taskId_key" ON "message_review_samples"("agencyId", "taskId");
CREATE INDEX IF NOT EXISTS "message_review_samples_agencyId_verdict_createdAt_idx" ON "message_review_samples"("agencyId", "verdict", "createdAt");
CREATE INDEX IF NOT EXISTS "message_review_samples_agencyId_sampledReason_createdAt_idx" ON "message_review_samples"("agencyId", "sampledReason", "createdAt");
