-- Ensure ConversationState enum exists with all required values
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');
  END IF;
END $$;

-- Add PAUSED if it doesn't exist
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumlabel = 'PAUSED' 
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ConversationState')
    ) THEN
      ALTER TYPE "ConversationState" ADD VALUE 'PAUSED';
    END IF;
  END IF;
END $$;

-- Add CLOSED if it doesn't exist
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumlabel = 'CLOSED' 
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ConversationState')
    ) THEN
      ALTER TYPE "ConversationState" ADD VALUE 'CLOSED';
    END IF;
  END IF;
END $$;

-- Ensure state column exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'conversations' 
    AND column_name = 'state'
  ) THEN
    ALTER TABLE "conversations" ADD COLUMN "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE';
  END IF;
END $$;

-- Ensure pausedReason column exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'conversations' 
    AND column_name = 'pausedReason'
  ) THEN
    ALTER TABLE "conversations" ADD COLUMN "pausedReason" TEXT;
  END IF;
END $$;

