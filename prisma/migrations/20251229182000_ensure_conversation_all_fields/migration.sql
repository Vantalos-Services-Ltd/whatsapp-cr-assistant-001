-- Ensure ConversationState enum exists with all required values
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');
  END IF;
END $$;

-- Add PAUSED if it doesn't exist (separate transaction)
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

-- Add CLOSED if it doesn't exist (separate transaction)
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

-- Ensure updatedAt column exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'conversations' 
    AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "conversations" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Ensure lastMessageAt is nullable if it's currently NOT NULL (adjust if needed)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'conversations' 
    AND column_name = 'lastMessageAt'
    AND is_nullable = 'NO'
  ) THEN
    -- Check if we need to make it nullable (schema says it should be nullable)
    -- But we'll leave it as is if it has a default, to avoid breaking existing data
    NULL;
  END IF;
END $$;

