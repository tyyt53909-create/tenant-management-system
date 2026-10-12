-- CreateIndex
CREATE UNIQUE INDEX "payment_records_billId_transactionNumber_key" ON "payment_records"("billId", "transactionNumber");
