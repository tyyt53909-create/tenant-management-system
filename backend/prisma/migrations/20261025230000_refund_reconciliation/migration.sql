-- T294 / PAY-02: 微信退款与日终对账表
-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconciliationBatchStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationItemType" AS ENUM ('MATCHED', 'SYSTEM_MISSING', 'WECHAT_MISSING', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH');

-- CreateTable
CREATE TABLE IF NOT EXISTS "refund_records" (
    "id" TEXT NOT NULL,
    "paymentRecordId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "outRefundNo" TEXT NOT NULL,
    "refundId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PROCESSING',
    "channel" TEXT NOT NULL DEFAULT 'WECHAT',
    "operatorId" TEXT NOT NULL,
    "userReceivedAccount" TEXT,
    "successAt" TIMESTAMP(3),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_reconciliation_batches" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WECHAT',
    "totalWechatCount" INTEGER NOT NULL DEFAULT 0,
    "totalWechatAmount" INTEGER NOT NULL DEFAULT 0,
    "totalSystemCount" INTEGER NOT NULL DEFAULT 0,
    "totalSystemAmount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ReconciliationBatchStatus" NOT NULL DEFAULT 'COMPLETED',
    "summary" JSONB,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_reconciliation_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "outTradeNo" TEXT,
    "transactionId" TEXT,
    "outRefundNo" TEXT,
    "refundId" TEXT,
    "wechatAmount" INTEGER,
    "systemAmount" INTEGER,
    "wechatStatus" TEXT,
    "systemStatus" TEXT,
    "type" "ReconciliationItemType" NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolveNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refund_records_outRefundNo_key" ON "refund_records"("outRefundNo");
CREATE UNIQUE INDEX IF NOT EXISTS "refund_records_refundId_key" ON "refund_records"("refundId");
CREATE INDEX IF NOT EXISTS "refund_records_paymentRecordId_idx" ON "refund_records"("paymentRecordId");
CREATE INDEX IF NOT EXISTS "refund_records_billId_idx" ON "refund_records"("billId");
CREATE INDEX IF NOT EXISTS "refund_records_status_idx" ON "refund_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reconciliation_batches_batchNumber_key" ON "payment_reconciliation_batches"("batchNumber");
CREATE INDEX IF NOT EXISTS "payment_reconciliation_batches_billDate_idx" ON "payment_reconciliation_batches"("billDate");
CREATE INDEX IF NOT EXISTS "payment_reconciliation_batches_status_idx" ON "payment_reconciliation_batches"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_reconciliation_items_batchId_type_idx" ON "payment_reconciliation_items"("batchId", "type");
CREATE INDEX IF NOT EXISTS "payment_reconciliation_items_outTradeNo_idx" ON "payment_reconciliation_items"("outTradeNo");
CREATE INDEX IF NOT EXISTS "payment_reconciliation_items_transactionId_idx" ON "payment_reconciliation_items"("transactionId");

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_reconciliation_items" ADD CONSTRAINT "payment_reconciliation_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "payment_reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
