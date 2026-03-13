-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('HUMAN', 'AI', 'OPERATOR');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "senderRole" "MessageSenderRole" NOT NULL DEFAULT 'HUMAN';

-- Backfill existing messages:
-- OUTBOUND messages are AI (system-generated)
-- INBOUND messages are HUMAN (from candidates)
UPDATE "messages" 
SET "senderRole" = CASE 
  WHEN "direction" = 'OUTBOUND' THEN 'AI'::"MessageSenderRole"
  WHEN "direction" = 'INBOUND' THEN 'HUMAN'::"MessageSenderRole"
  ELSE 'HUMAN'::"MessageSenderRole"
END;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_senderRole_idx" ON "messages"("senderRole");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_direction_senderRole_idx" ON "messages"("direction", "senderRole");
