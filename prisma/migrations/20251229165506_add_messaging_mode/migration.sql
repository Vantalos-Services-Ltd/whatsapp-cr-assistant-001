-- CreateEnum
CREATE TYPE "MessagingMode" AS ENUM ('AUTOPILOT', 'HYBRID', 'APPROVAL_ONLY');

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "messagingMode" "MessagingMode" NOT NULL DEFAULT 'APPROVAL_ONLY';
