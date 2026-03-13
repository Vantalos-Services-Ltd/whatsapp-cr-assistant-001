-- Add PAUSED enum value if it doesn't exist
-- ALTER TYPE ADD VALUE commits implicitly in PostgreSQL
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

-- Add CLOSED enum value if it doesn't exist
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

