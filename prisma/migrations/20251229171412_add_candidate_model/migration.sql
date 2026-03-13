-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('WHATSAPP');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "candidateId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "candidateId" TEXT;

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "location" TEXT,
    "desiredRole" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yearsExperience" INTEGER,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT,
    "availabilityNotes" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConversationId" TEXT,
    "source" "CandidateSource" NOT NULL,
    "rawProfile" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidates_agencyId_idx" ON "candidates"("agencyId");

-- CreateIndex
CREATE INDEX "candidates_phone_idx" ON "candidates"("phone");

-- CreateIndex
CREATE INDEX "candidates_source_idx" ON "candidates"("source");

-- CreateIndex
CREATE INDEX "candidates_lastSeenAt_idx" ON "candidates"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_agencyId_phone_key" ON "candidates"("agencyId", "phone");

-- CreateIndex
CREATE INDEX "tasks_candidateId_idx" ON "tasks"("candidateId");

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_lastConversationId_fkey" FOREIGN KEY ("lastConversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
