-- Step 1: Add PAUSED enum value if it doesn't exist
-- ALTER TYPE ADD VALUE commits implicitly in PostgreSQL, making the value available
-- for use in subsequent statements within this migration
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

-- Step 2: Add CLOSED enum value if it doesn't exist
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

-- Step 3: Update any existing PAUSED_FOR_APPROVAL values to PAUSED
-- This runs after the PAUSED enum value has been added (and committed by PostgreSQL)
-- The UPDATE statement can safely use PAUSED because ALTER TYPE ADD VALUE commits implicitly
UPDATE "conversations" 
SET "state" = 'PAUSED'::"ConversationState"
WHERE "state"::text = 'PAUSED_FOR_APPROVAL'
  AND EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'PAUSED' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ConversationState')
  );

