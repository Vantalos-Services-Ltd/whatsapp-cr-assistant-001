-- AlterTable: Add missing reliability tracking fields to tasks
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'stuckAt') THEN
        ALTER TABLE "tasks" ADD COLUMN "stuckAt" TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'lastTouchedAt') THEN
        ALTER TABLE "tasks" ADD COLUMN "lastTouchedAt" TIMESTAMPTZ;
    END IF;
END $$;

-- CreateIndex: For stuck task queries (if not exists)
CREATE INDEX IF NOT EXISTS "tasks_agencyId_stuckAt_idx" ON "tasks"("agencyId", "stuckAt");

