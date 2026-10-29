ALTER TABLE "refund_records" ADD COLUMN "requestKey" TEXT;
ALTER TABLE "refund_records" ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "refund_records_requestKey_key" ON "refund_records"("requestKey");
