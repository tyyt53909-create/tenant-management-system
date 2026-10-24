-- FIN-04 / T272：账单逾期标记与滞纳金按日应计。
-- 1) bills 增加 isOverdue / overdueDays，status 只保留缴付进度；
-- 2) 现有 OVERDUE 行回填为 PENDING/PARTIAL + isOverdue=true；
-- 3) 新增 late_fee_accruals（按日增量，唯一键幂等）。

ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "isOverdue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "overdueDays" INTEGER NOT NULL DEFAULT 0;

UPDATE "bills"
SET
  "isOverdue" = true,
  "overdueDays" = GREATEST(0, CURRENT_DATE - "dueDate"),
  "status" = CASE
    WHEN "paidAmount" > 0 AND "paidAmount" < "amount" THEN 'PARTIAL'::"BillStatus"
    ELSE 'PENDING'::"BillStatus"
  END
WHERE "status" = 'OVERDUE';

CREATE INDEX IF NOT EXISTS "bills_isOverdue_dueDate_idx" ON "bills"("isOverdue", "dueDate");

CREATE TABLE IF NOT EXISTS "late_fee_accruals" (
  "id" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "accrualDate" DATE NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "late_fee_accruals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "late_fee_accruals_billId_accrualDate_key"
  ON "late_fee_accruals"("billId", "accrualDate");
CREATE INDEX IF NOT EXISTS "late_fee_accruals_billId_idx" ON "late_fee_accruals"("billId");

DO $$ BEGIN
  ALTER TABLE "late_fee_accruals"
    ADD CONSTRAINT "late_fee_accruals_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
