-- T320 / R07：押金操作幂等键。可空，历史流水不受影响。
ALTER TABLE "deposit_transactions" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "deposit_transactions_idempotencyKey_key"
  ON "deposit_transactions"("idempotencyKey");
