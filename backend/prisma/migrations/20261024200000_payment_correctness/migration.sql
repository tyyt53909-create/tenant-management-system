-- FIN-05 / T264：收款幂等、收据号、作废冲正。
-- 1) 新增 PaymentStatus 枚举与收款记录字段；
-- 2) 收据号使用数据库序列原子分配（避免 count+1 并发重号）；
-- 3) 历史记录标记为 CONFIRMED，billPortion 暂按 amount 回填（历史数据无法拆分滞纳金）。

CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'VOIDED', 'REVERSAL');

ALTER TABLE "payment_records"
  ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "receiptNumber" TEXT,
  ADD COLUMN "billPortion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeePortion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeeAllocations" JSONB,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedBy" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "reversalOfId" TEXT;

CREATE UNIQUE INDEX "payment_records_idempotencyKey_key" ON "payment_records"("idempotencyKey");
CREATE UNIQUE INDEX "payment_records_receiptNumber_key" ON "payment_records"("receiptNumber");
CREATE UNIQUE INDEX "payment_records_reversalOfId_key" ON "payment_records"("reversalOfId");
CREATE INDEX "payment_records_status_idx" ON "payment_records"("status");

ALTER TABLE "payment_records"
  ADD CONSTRAINT "payment_records_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "payment_records"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SEQUENCE IF NOT EXISTS "payment_receipt_seq" START 1;

-- 历史收款：全部视为已确认；本金部分按 amount 回填（无法还原滞纳金拆分）
UPDATE "payment_records"
SET "status" = 'CONFIRMED',
    "billPortion" = "amount",
    "lateFeePortion" = 0
WHERE "status" = 'CONFIRMED';
