-- CreateEnum
CREATE TYPE "ReviewVerdict" AS ENUM ('GOOD', 'NEEDS_IMPROVEMENT', 'UNSAFE');

-- CreateEnum
CREATE TYPE "SampledReason" AS ENUM ('EDITED', 'HIGH_RISK', 'RANDOM');

-- CreateTable
CREATE TABLE "message_review_samples" (
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

-- CreateIndex
CREATE UNIQUE INDEX "message_review_samples_agencyId_taskId_key" ON "message_review_samples"("agencyId", "taskId");

-- CreateIndex
CREATE INDEX "message_review_samples_agencyId_verdict_createdAt_idx" ON "message_review_samples"("agencyId", "verdict", "createdAt");

-- CreateIndex
CREATE INDEX "message_review_samples_agencyId_sampledReason_createdAt_idx" ON "message_review_samples"("agencyId", "sampledReason", "createdAt");

-- AddForeignKey
ALTER TABLE "message_review_samples" ADD CONSTRAINT "message_review_samples_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_review_samples" ADD CONSTRAINT "message_review_samples_reviewedByOperatorId_fkey" FOREIGN KEY ("reviewedByOperatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

