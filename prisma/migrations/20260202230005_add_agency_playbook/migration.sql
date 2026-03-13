-- CreateEnum
CREATE TYPE "GreetingStyle" AS ENUM ('SHORT', 'NONE', 'NORMAL');

-- CreateEnum
CREATE TYPE "SignatureStyle" AS ENUM ('NONE', 'NAME', 'AGENCY');

-- CreateTable
CREATE TABLE "agency_playbooks" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "toneStyle" TEXT NOT NULL DEFAULT 'UK recruiter, friendly, direct',
    "maxQuestionsPerMessage" INTEGER NOT NULL DEFAULT 2,
    "greetingStyle" "GreetingStyle" NOT NULL DEFAULT 'SHORT',
    "forbiddenPhrases" JSONB NOT NULL DEFAULT '[]',
    "requiredChecks" JSONB NOT NULL DEFAULT '{}',
    "escalationRules" JSONB NOT NULL DEFAULT '{}',
    "signatureStyle" "SignatureStyle" NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_playbooks_agencyId_key" ON "agency_playbooks"("agencyId");

-- CreateIndex
CREATE INDEX "agency_playbooks_agencyId_idx" ON "agency_playbooks"("agencyId");

-- AddForeignKey
ALTER TABLE "agency_playbooks" ADD CONSTRAINT "agency_playbooks_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

