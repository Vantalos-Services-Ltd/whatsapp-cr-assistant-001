-- CreateEnum
CREATE TYPE "TaskApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approvalStatus" "TaskApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "proposedAction" JSONB;

-- CreateIndex
CREATE INDEX "tasks_approvedByUserId_idx" ON "tasks"("approvedByUserId");

-- CreateIndex
CREATE INDEX "tasks_approvalStatus_idx" ON "tasks"("approvalStatus");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
