-- FIN-03 / T267：押金账单类型与押金台账。
-- 1) BillType 增加 DEPOSIT；
-- 2) 新增 deposit_ledgers / deposit_transactions 两张表与枚举。

ALTER TYPE "BillType" ADD VALUE IF NOT EXISTS 'DEPOSIT';

DO $$ BEGIN
  CREATE TYPE "DepositStatus" AS ENUM ('HELD', 'REFUNDED', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DepositTransactionType" AS ENUM ('COLLECT', 'REFUND', 'DEDUCT', 'TRANSFER', 'REVERSAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "deposit_ledgers" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "status" "DepositStatus" NOT NULL DEFAULT 'HELD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deposit_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "deposit_ledgers_contractId_key" ON "deposit_ledgers"("contractId");
CREATE INDEX IF NOT EXISTS "deposit_ledgers_tenantId_idx" ON "deposit_ledgers"("tenantId");
CREATE INDEX IF NOT EXISTS "deposit_ledgers_roomId_idx" ON "deposit_ledgers"("roomId");

CREATE TABLE IF NOT EXISTS "deposit_transactions" (
  "id" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "type" "DepositTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "relatedType" TEXT,
  "relatedId" TEXT,
  "operatorId" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deposit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deposit_transactions_ledgerId_createdAt_idx" ON "deposit_transactions"("ledgerId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "deposit_ledgers"
    ADD CONSTRAINT "deposit_ledgers_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "deposit_transactions"
    ADD CONSTRAINT "deposit_transactions_ledgerId_fkey"
    FOREIGN KEY ("ledgerId") REFERENCES "deposit_ledgers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
