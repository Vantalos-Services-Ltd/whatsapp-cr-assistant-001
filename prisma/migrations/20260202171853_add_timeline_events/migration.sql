-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('INBOUND_MESSAGE_RECEIVED', 'AI_SUGGESTION_CREATED', 'TASK_CREATED', 'TASK_APPROVED', 'TASK_REJECTED', 'PROGRESS_STAGE_CHANGED', 'MEMORY_PACK_UPDATED', 'CSCS_AUTO_VERIFIED', 'CSCS_APPROVED', 'CSCS_REJECTED', 'OUTREACH_SENT', 'FOLLOW_UP_CREATED');

-- CreateEnum
CREATE TYPE "TimelineActorRole" AS ENUM ('SYSTEM', 'AI', 'OPERATOR');

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "candidateId" TEXT,
    "type" "TimelineEventType" NOT NULL,
    "actorRole" "TimelineActorRole" NOT NULL,
    "actorOperatorId" TEXT,
    "summary" VARCHAR(200) NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timeline_events_agencyId_conversationId_createdAt_idx" ON "timeline_events"("agencyId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "timeline_events_agencyId_contactId_createdAt_idx" ON "timeline_events"("agencyId", "contactId", "createdAt");

-- CreateIndex
CREATE INDEX "timeline_events_agencyId_type_createdAt_idx" ON "timeline_events"("agencyId", "type", "createdAt");

-- CreateIndex (partial unique index for idempotency - only when dedupeKey is not null)
CREATE UNIQUE INDEX "timeline_events_agency_dedupe_unique" ON "timeline_events"("agencyId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actorOperatorId_fkey" FOREIGN KEY ("actorOperatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
