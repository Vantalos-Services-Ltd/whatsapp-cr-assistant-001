-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;
