-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'URGENT', 'PAUSED', 'FILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MatchTier" AS ENUM ('PROVEN', 'EXCELLENT', 'GOOD', 'WEAK');

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "lastMessageAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "tradeRequired" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "durationWeeks" INTEGER,
    "hoursPerDay" INTEGER,
    "daysPerWeek" INTEGER,
    "positionsOpen" INTEGER NOT NULL DEFAULT 1,
    "positionsFilled" INTEGER NOT NULL DEFAULT 0,
    "siteName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "clientName" TEXT,
    "clientType" TEXT,
    "siteManagerName" TEXT,
    "siteManagerPhone" TEXT,
    "isPremiumClient" BOOLEAN NOT NULL DEFAULT false,
    "requirementsJson" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "payRate" DOUBLE PRECISION,
    "chargeRate" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_candidate_matches" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "MatchTier" NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_candidate_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_agencyId_idx" ON "jobs"("agencyId");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "job_candidate_matches_agencyId_idx" ON "job_candidate_matches"("agencyId");

-- CreateIndex
CREATE INDEX "job_candidate_matches_jobId_idx" ON "job_candidate_matches"("jobId");

-- CreateIndex
CREATE INDEX "job_candidate_matches_candidateId_idx" ON "job_candidate_matches"("candidateId");

-- CreateIndex
CREATE INDEX "job_candidate_matches_score_idx" ON "job_candidate_matches"("score");

-- CreateIndex
CREATE INDEX "job_candidate_matches_tier_idx" ON "job_candidate_matches"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "job_candidate_matches_jobId_candidateId_key" ON "job_candidate_matches"("jobId", "candidateId");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_candidate_matches" ADD CONSTRAINT "job_candidate_matches_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_candidate_matches" ADD CONSTRAINT "job_candidate_matches_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_candidate_matches" ADD CONSTRAINT "job_candidate_matches_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
