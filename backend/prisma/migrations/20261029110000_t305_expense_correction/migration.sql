ALTER TABLE "operating_expenses" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "operating_expenses" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "operating_expenses" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
