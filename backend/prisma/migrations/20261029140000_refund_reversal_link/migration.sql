ALTER TABLE "payment_records" ADD COLUMN "refundReversalId" TEXT;
CREATE UNIQUE INDEX "payment_records_refundReversalId_key" ON "payment_records"("refundReversalId");
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_refundReversalId_fkey" FOREIGN KEY ("refundReversalId") REFERENCES "refund_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
