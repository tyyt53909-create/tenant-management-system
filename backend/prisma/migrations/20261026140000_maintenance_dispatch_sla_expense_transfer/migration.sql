-- T303 / WRK-02: 维修工单派工、SLA、员工端与费用转嫁

-- AlterEnum BillType
ALTER TYPE "BillType" ADD VALUE IF NOT EXISTS 'MAINTENANCE';

-- AlterTable maintenance_requests
ALTER TABLE "maintenance_requests"
ADD COLUMN IF NOT EXISTS "assignedMaintainerId" TEXT,
ADD COLUMN IF NOT EXISTS "responseDueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "slaDueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isSlaBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "slaBreachedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "slaBreachType" TEXT,
ADD COLUMN IF NOT EXISTS "laborCost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "materialCost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "totalCost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "tenantFault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "faultReason" TEXT,
ADD COLUMN IF NOT EXISTS "expenseTransferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "expenseBillId" TEXT,
ADD COLUMN IF NOT EXISTS "expenseTransferredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_requests_expenseBillId_key" ON "maintenance_requests"("expenseBillId");
CREATE INDEX IF NOT EXISTS "maintenance_requests_assignedMaintainerId_idx" ON "maintenance_requests"("assignedMaintainerId");
CREATE INDEX IF NOT EXISTS "maintenance_requests_isSlaBreached_idx" ON "maintenance_requests"("isSlaBreached");

-- AddForeignKey
ALTER TABLE "maintenance_requests" DROP CONSTRAINT IF EXISTS "maintenance_requests_assignedMaintainerId_fkey";
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignedMaintainerId_fkey" FOREIGN KEY ("assignedMaintainerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "maintenance_requests" DROP CONSTRAINT IF EXISTS "maintenance_requests_expenseBillId_fkey";
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_expenseBillId_fkey" FOREIGN KEY ("expenseBillId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
