-- AlterTable
ALTER TABLE "meter_responsibility_intervals" ALTER COLUMN "endAt" DROP NOT NULL,
ALTER COLUMN "closingReadingId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "utility_charges" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "contractId" TEXT,
    "tenantId" TEXT,
    "responsibilityIntervalId" TEXT NOT NULL,
    "policyVersionId" TEXT,
    "baselineReadingId" TEXT NOT NULL,
    "targetReadingId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "collectionMode" "UtilityCollectionMode",
    "usage" DECIMAL(14,2) NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "prepayApplied" INTEGER NOT NULL,
    "receivableAmount" INTEGER NOT NULL,
    "providerAmount" INTEGER NOT NULL,
    "billId" TEXT,
    "prepayTransactionId" TEXT,
    "snapshot" JSONB NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificationState" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "utility_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "utility_posting_confirmations" (
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utility_posting_confirmations_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "utility_charges_billId_key" ON "utility_charges"("billId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "utility_charges_prepayTransactionId_key" ON "utility_charges"("prepayTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "utility_charges_contractId_createdAt_idx" ON "utility_charges"("contractId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "utility_charges_meterId_baselineReadingId_targetReadingId_key" ON "utility_charges"("meterId", "baselineReadingId", "targetReadingId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_meterId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_roomId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_contractId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_tenantId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_responsibilityIntervalId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_responsibilityIntervalId_fkey" FOREIGN KEY ("responsibilityIntervalId") REFERENCES "meter_responsibility_intervals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_policyVersionId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "utility_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_baselineReadingId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_baselineReadingId_fkey" FOREIGN KEY ("baselineReadingId") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_targetReadingId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_targetReadingId_fkey" FOREIGN KEY ("targetReadingId") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_billId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charges_prepayTransactionId_fkey' AND conrelid = 'utility_charges'::regclass) THEN
    ALTER TABLE "utility_charges" ADD CONSTRAINT "utility_charges_prepayTransactionId_fkey" FOREIGN KEY ("prepayTransactionId") REFERENCES "prepay_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;


-- Expand: an open responsibility has no invented final reading. Closing appends real evidence.
ALTER TABLE meter_responsibility_intervals DROP CONSTRAINT IF EXISTS meter_responsibility_valid_bounds;
ALTER TABLE meter_responsibility_intervals ADD CONSTRAINT meter_responsibility_valid_bounds CHECK (
  ("endAt" IS NULL AND "closingReadingId" IS NULL AND responsibility = 'TENANT')
  OR ("endAt" IS NOT NULL AND "closingReadingId" IS NOT NULL AND "startAt" < "endAt" AND "openingReadingId" <> "closingReadingId")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charge_no_overlap') THEN
    ALTER TABLE utility_charges ADD CONSTRAINT utility_charge_no_overlap
      EXCLUDE USING gist ("meterId" WITH =, tsrange("startAt", "endAt", '[)') WITH &&);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_charge_conservation') THEN
    ALTER TABLE utility_charges ADD CONSTRAINT utility_charge_conservation CHECK (
      "startAt" < "endAt" AND "baselineReadingId" <> "targetReadingId" AND usage >= 0
      AND "totalAmount" >= 0 AND "prepayApplied" >= 0 AND "receivableAmount" >= 0 AND "providerAmount" >= 0
      AND ("billId" IS NOT NULL) = ("receivableAmount" > 0)
      AND ("prepayTransactionId" IS NOT NULL) = ("prepayApplied" > 0)
      AND (("collectionMode" IS NOT NULL AND "collectionMode" = 'PREPAY_WITH_SHORTFALL' AND "contractId" IS NOT NULL AND "tenantId" IS NOT NULL AND "policyVersionId" IS NOT NULL
             AND "totalAmount"::bigint = "prepayApplied"::bigint + "receivableAmount"::bigint AND "providerAmount" = 0)
        OR ("collectionMode" IS NOT NULL AND "collectionMode" = 'POSTPAID' AND "contractId" IS NOT NULL AND "tenantId" IS NOT NULL AND "policyVersionId" IS NOT NULL
             AND "prepayApplied" = 0 AND "providerAmount" = 0 AND "totalAmount" = "receivableAmount")
        OR ("collectionMode" IS NOT NULL AND "collectionMode" = 'DIRECT_TO_PROVIDER' AND "contractId" IS NOT NULL AND "tenantId" IS NOT NULL AND "policyVersionId" IS NOT NULL
             AND "prepayApplied" = 0 AND "receivableAmount" = 0 AND "totalAmount" = "providerAmount")
        OR ("collectionMode" IS NULL AND "contractId" IS NULL AND "tenantId" IS NULL AND "policyVersionId" IS NULL
             AND "totalAmount" = 0 AND "prepayApplied" = 0 AND "receivableAmount" = 0 AND "providerAmount" = 0))
    );
  END IF;
END $$;
