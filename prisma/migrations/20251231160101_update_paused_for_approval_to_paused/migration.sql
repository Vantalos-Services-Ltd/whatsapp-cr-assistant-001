-- Update any existing PAUSED_FOR_APPROVAL values to PAUSED
-- This runs after the PAUSED enum value has been added and committed
UPDATE "conversations" 
SET "state" = 'PAUSED'::"ConversationState"
WHERE "state"::text = 'PAUSED_FOR_APPROVAL'
  AND EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'PAUSED' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ConversationState')
  );

