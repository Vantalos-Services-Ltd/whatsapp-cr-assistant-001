/*
  Warnings:

  - You are about to drop the `ai_suggestions` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TaskType" ADD VALUE 'CSCS_VERIFICATION';

-- DropForeignKey
ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_agencyId_fkey";

-- DropForeignKey
ALTER TABLE "ai_suggestions" DROP CONSTRAINT "ai_suggestions_conversationId_fkey";

-- DropTable
DROP TABLE "ai_suggestions";

-- DropEnum
DROP TYPE "AiSuggestionStatus";

-- CreateTable
CREATE TABLE "placements" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "PlacementStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "placements_agencyId_idx" ON "placements"("agencyId");

-- CreateIndex
CREATE INDEX "placements_jobId_idx" ON "placements"("jobId");

-- CreateIndex
CREATE INDEX "placements_candidateId_idx" ON "placements"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "placements_jobId_candidateId_key" ON "placements"("jobId", "candidateId");

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
