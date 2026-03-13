-- AlterEnum
-- Add enum value (must be committed before use in same transaction)
ALTER TYPE "MessageDeliveryStatus" ADD VALUE IF NOT EXISTS 'QUEUED';

-- AlterTable
-- Add new columns
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- Note: Setting default to QUEUED is done in a separate migration
-- to avoid "unsafe use of new enum value" error
