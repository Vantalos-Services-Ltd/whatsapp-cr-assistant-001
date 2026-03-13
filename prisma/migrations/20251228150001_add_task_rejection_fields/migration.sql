-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

