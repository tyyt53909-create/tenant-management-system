-- CreateEnum
DO $$ BEGIN CREATE TYPE "UtilityCollectionMode" AS ENUM ('PREPAY_WITH_SHORTFALL', 'POSTPAID', 'DIRECT_TO_PROVIDER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "MeterResponsibilityType" AS ENUM ('TENANT', 'OWNER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "utility_policy_versions" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "feeType" "MeterType" NOT NULL,
    "version" INTEGER NOT NULL,
    "collectionMode" "UtilityCollectionMode" NOT NULL,
    "calculationMode" TEXT NOT NULL DEFAULT 'METER_DELTA_FLAT_RATE',
    "rateCents" DECIMAL(16,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "roundingRule" TEXT NOT NULL DEFAULT 'HALF_UP_CHARGE_V1',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "utility_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "meter_responsibility_intervals" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "contractId" TEXT,
    "tenantId" TEXT,
    "responsibility" "MeterResponsibilityType" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "openingReadingId" TEXT NOT NULL,
    "closingReadingId" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "meter_responsibility_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "utility_rule_confirmations" (
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utility_rule_confirmations_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "utility_policy_versions_contractId_feeType_version_key" ON "utility_policy_versions"("contractId", "feeType", "version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "utility_policy_versions_contractId_feeType_effectiveFrom_key" ON "utility_policy_versions"("contractId", "feeType", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meter_responsibility_intervals_meterId_startAt_endAt_idx" ON "meter_responsibility_intervals"("meterId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meter_responsibility_intervals_contractId_idx" ON "meter_responsibility_intervals"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "meter_responsibility_intervals_meterId_openingReadingId_clo_key" ON "meter_responsibility_intervals"("meterId", "openingReadingId", "closingReadingId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_policy_versions_contractId_fkey' AND conrelid = 'utility_policy_versions'::regclass) THEN
    ALTER TABLE "utility_policy_versions" ADD CONSTRAINT "utility_policy_versions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_meterId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_roomId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_contractId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_tenantId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_openingReadingId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_openingReadingId_fkey" FOREIGN KEY ("openingReadingId") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_intervals_closingReadingId_fkey' AND conrelid = 'meter_responsibility_intervals'::regclass) THEN
    ALTER TABLE "meter_responsibility_intervals" ADD CONSTRAINT "meter_responsibility_intervals_closingReadingId_fkey" FOREIGN KEY ("closingReadingId") REFERENCES "meter_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;


-- PostgreSQL owns overlap protection, including writers outside the HTTP entry point.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_no_overlap') THEN
    ALTER TABLE meter_responsibility_intervals ADD CONSTRAINT meter_responsibility_no_overlap
      EXCLUDE USING gist ("meterId" WITH =, tsrange("startAt", "endAt", '[)') WITH &&);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_valid_bounds') THEN
    ALTER TABLE meter_responsibility_intervals ADD CONSTRAINT meter_responsibility_valid_bounds
      CHECK ("startAt" < "endAt" AND "openingReadingId" <> "closingReadingId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meter_responsibility_owner_shape') THEN
    ALTER TABLE meter_responsibility_intervals ADD CONSTRAINT meter_responsibility_owner_shape CHECK (
      (responsibility = 'TENANT' AND "contractId" IS NOT NULL AND "tenantId" IS NOT NULL)
      OR (responsibility = 'OWNER' AND "contractId" IS NULL AND "tenantId" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utility_policy_supported_rule') THEN
    ALTER TABLE utility_policy_versions ADD CONSTRAINT utility_policy_supported_rule
      CHECK (version > 0 AND "rateCents" >= 0 AND "calculationMode" = 'METER_DELTA_FLAT_RATE'
        AND "roundingRule" = 'HALF_UP_CHARGE_V1' AND btrim(evidence) <> '');
  END IF;
END $$;
