-- AlterTable: Add reliability tracking fields to tasks
ALTER TABLE "tasks" ADD COLUMN "stuckAt" TIMESTAMP(3),
ADD COLUMN "lastTouchedAt" TIMESTAMP(3),
ADD COLUMN "inboundMessageId" TEXT,
ADD COLUMN "processingKey" TEXT;

-- CreateIndex: For stuck task detection queries
CREATE INDEX "tasks_agencyId_status_type_createdAt_idx" ON "tasks"("agencyId", "status", "type", "createdAt");

-- CreateIndex: For stuck task queries
CREATE INDEX "tasks_agencyId_stuckAt_idx" ON "tasks"("agencyId", "stuckAt");

-- CreateIndex: For idempotency and replay deduplication
CREATE INDEX "tasks_agencyId_inboundMessageId_idx" ON "tasks"("agencyId", "inboundMessageId");


