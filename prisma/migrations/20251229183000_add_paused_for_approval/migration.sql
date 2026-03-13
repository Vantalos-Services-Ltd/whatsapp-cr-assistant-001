-- Add PAUSED_FOR_APPROVAL enum value if it doesn't exist
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumlabel = 'PAUSED_FOR_APPROVAL' 
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ConversationState')
    ) THEN
      ALTER TYPE "ConversationState" ADD VALUE 'PAUSED_FOR_APPROVAL';
    END IF;
  END IF;
END $$;

