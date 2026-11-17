ALTER TABLE "meter_readings"
  ADD COLUMN IF NOT EXISTS "handoffRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "handoffPreviousFinal" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "handoffConfirmedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "handoffConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "settledSegments" JSONB;
