-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "dueAt" TIMESTAMP(3),
ADD COLUMN "isSystemGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tasks_dueAt_idx" ON "tasks"("dueAt");

