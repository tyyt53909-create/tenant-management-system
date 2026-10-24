-- FIN-08 / T274：抄表去重、结构化结算与表级生效单价。
-- expand-only：新增可空列与索引，不删除、不改写既有数据。
-- 历史读数的 settledAt 保持为空，由服务层继续以 [SETTLED]/[INITIAL] 备注识别。

-- 1) 读数去重键与结构化结算字段
ALTER TABLE "meter_readings" ADD COLUMN IF NOT EXISTS "dedupKey" TEXT;
ALTER TABLE "meter_readings" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);
ALTER TABLE "meter_readings" ADD COLUMN IF NOT EXISTS "settledUsage" DECIMAL(10, 2);
ALTER TABLE "meter_readings" ADD COLUMN IF NOT EXISTS "settledUnitPrice" INTEGER;
ALTER TABLE "meter_readings" ADD COLUMN IF NOT EXISTS "settledAmount" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "meter_readings_meterId_dedupKey_key"
  ON "meter_readings"("meterId", "dedupKey");

-- 2) 表级单价历史
ALTER TABLE "meter_price_history" ADD COLUMN IF NOT EXISTS "meterId" TEXT;

CREATE INDEX IF NOT EXISTS "meter_price_history_meterId_effectiveDate_idx"
  ON "meter_price_history"("meterId", "effectiveDate");

DO $$ BEGIN
  ALTER TABLE "meter_price_history"
    ADD CONSTRAINT "meter_price_history_meterId_fkey"
    FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
