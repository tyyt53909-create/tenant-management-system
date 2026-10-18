-- AlterTable
ALTER TABLE "bills" ADD COLUMN "dedupKey" TEXT;
ALTER TABLE "notifications" ADD COLUMN "dedupKey" TEXT;

-- CreateIndex
-- PostgreSQL 唯一索引允许多个 NULL，因此只有写入了 dedupKey 的账单和通知才会去重。
CREATE UNIQUE INDEX "bills_dedupKey_key" ON "bills"("dedupKey");
CREATE UNIQUE INDEX "notifications_dedupKey_key" ON "notifications"("dedupKey");
