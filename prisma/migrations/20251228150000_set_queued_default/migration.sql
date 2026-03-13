-- Set default deliveryStatus to QUEUED
-- This is done in a separate migration because enum values must be committed
-- before they can be used as defaults
ALTER TABLE "messages" ALTER COLUMN "deliveryStatus" SET DEFAULT 'QUEUED';

