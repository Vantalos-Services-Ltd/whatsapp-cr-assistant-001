-- AlterTable: Add new columns (nullable first for safe backfill)
ALTER TABLE "conversations" ADD COLUMN     "memoryPack" JSONB,
ADD COLUMN     "memoryUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "progressData" JSONB,
ADD COLUMN     "progressStage" TEXT,
ADD COLUMN     "progressUpdatedAt" TIMESTAMP(3);

-- Backfill existing rows: Set defaults for new columns
UPDATE "conversations" 
SET 
  "progressStage" = 'NEW',
  "progressUpdatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE "progressStage" IS NULL;

-- Set NOT NULL constraints and defaults after backfill
ALTER TABLE "conversations" 
  ALTER COLUMN "progressStage" SET NOT NULL,
  ALTER COLUMN "progressStage" SET DEFAULT 'NEW',
  ALTER COLUMN "progressUpdatedAt" SET NOT NULL,
  ALTER COLUMN "progressUpdatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "conversations_progressStage_idx" ON "conversations"("progressStage");

-- CreateIndex
CREATE INDEX "conversations_progressUpdatedAt_idx" ON "conversations"("progressUpdatedAt");

-- CreateIndex
CREATE INDEX "conversations_memoryUpdatedAt_idx" ON "conversations"("memoryUpdatedAt");
