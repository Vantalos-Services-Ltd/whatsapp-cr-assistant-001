-- CreateEnum
CREATE TYPE "OpportunityActionLogStatus" AS ENUM ('CREATED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "opportunity_action_logs" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "opportunityKey" TEXT NOT NULL,
    "opportunityType" TEXT NOT NULL,
    "relatedJobId" TEXT,
    "relatedCandidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByOperatorId" TEXT,
    "taskId" TEXT,
    "status" "OpportunityActionLogStatus" NOT NULL,

    CONSTRAINT "opportunity_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_action_logs_agencyId_opportunityKey_relatedCandidateId_key" ON "opportunity_action_logs"("agencyId", "opportunityKey", "relatedCandidateId");

-- CreateIndex
CREATE INDEX "opportunity_action_logs_agencyId_opportunityType_createdAt_idx" ON "opportunity_action_logs"("agencyId", "opportunityType", "createdAt");

-- AddForeignKey
ALTER TABLE "opportunity_action_logs" ADD CONSTRAINT "opportunity_action_logs_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

