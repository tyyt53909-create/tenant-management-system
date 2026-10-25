-- T296 / PAY-04: 预付线上充值、自动扣费与低余额提醒

-- AlterEnum: PaymentMethod
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PREPAY';

-- AlterEnum: RelatedType
ALTER TYPE "RelatedType" ADD VALUE IF NOT EXISTS 'ONLINE_RECHARGE';
ALTER TYPE "RelatedType" ADD VALUE IF NOT EXISTS 'BILL_DEDUCTION';

-- CreateEnum: PrepayOrderStatus
CREATE TYPE "PrepayOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateTable: prepay_recharge_orders
CREATE TABLE IF NOT EXISTS "prepay_recharge_orders" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" "PrepayOrderStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'WECHAT',
    "paidAt" TIMESTAMP(3),
    "receiptNumber" TEXT,
    "operatorId" TEXT NOT NULL,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prepay_recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "prepay_recharge_orders_outTradeNo_key" ON "prepay_recharge_orders"("outTradeNo");
CREATE UNIQUE INDEX IF NOT EXISTS "prepay_recharge_orders_receiptNumber_key" ON "prepay_recharge_orders"("receiptNumber");
CREATE INDEX IF NOT EXISTS "prepay_recharge_orders_accountId_createdAt_idx" ON "prepay_recharge_orders"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "prepay_recharge_orders_tenantId_status_idx" ON "prepay_recharge_orders"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "prepay_recharge_orders" ADD CONSTRAINT "prepay_recharge_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "prepay_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prepay_recharge_orders" ADD CONSTRAINT "prepay_recharge_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
