/*
  Warnings:

  - You are about to drop the column `approvedByUserId` on the `tasks` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_approvedByUserId_fkey";

-- DropIndex
DROP INDEX "tasks_approvedByUserId_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "approvedByUserId",
ADD COLUMN     "approvedByOperatorId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_approvedByOperatorId_idx" ON "tasks"("approvedByOperatorId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approvedByOperatorId_fkey" FOREIGN KEY ("approvedByOperatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
