ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "leaseConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseConfirmedBy" TEXT;
