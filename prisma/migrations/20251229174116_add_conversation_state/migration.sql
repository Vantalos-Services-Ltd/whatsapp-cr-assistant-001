-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'PAUSED_FOR_APPROVAL');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "conversations" ADD COLUMN     "pausedReason" TEXT;
