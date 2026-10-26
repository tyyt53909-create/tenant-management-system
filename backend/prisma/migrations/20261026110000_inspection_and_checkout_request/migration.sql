-- T300 / LSE-03: 入住/退租验房与租客退租申请

-- CreateEnum InspectionType
CREATE TYPE "InspectionType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum InspectionStatus
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRM', 'CONFIRMED', 'REJECTED');

-- CreateEnum InspectionItemStatus
CREATE TYPE "InspectionItemStatus" AS ENUM ('INTACT', 'DAMAGED', 'MISSING', 'DIRTY');

-- CreateEnum CheckoutRequestStatus
CREATE TYPE "CheckoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum CheckoutReasonType
CREATE TYPE "CheckoutReasonType" AS ENUM ('NORMAL_EXPIRE', 'EARLY_TERMINATION', 'JOB_TRANSFER', 'PERSONAL_REASON', 'OTHER');

-- CreateTable room_inspections
CREATE TABLE IF NOT EXISTS "room_inspections" (
    "id" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "contractId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectorName" TEXT NOT NULL,
    "inspectorPhone" TEXT,
    "meterReadings" JSONB,
    "photos" JSONB,
    "overallNotes" TEXT,
    "tenantConfirmedAt" TIMESTAMP(3),
    "tenantNotes" TEXT,
    "tenantSignature" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable inspection_items
CREATE TABLE IF NOT EXISTS "inspection_items" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "InspectionItemStatus" NOT NULL DEFAULT 'INTACT',
    "damageDescription" TEXT,
    "repairCost" INTEGER NOT NULL DEFAULT 0,
    "photos" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable checkout_requests
CREATE TABLE IF NOT EXISTS "checkout_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expectedCheckoutDate" DATE NOT NULL,
    "reasonType" "CheckoutReasonType" NOT NULL DEFAULT 'NORMAL_EXPIRE',
    "reasonDetail" TEXT,
    "refundAccount" JSONB,
    "status" "CheckoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "checkoutRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_requests_pkey" PRIMARY KEY ("id")
);

-- AlterTable checkout_records
ALTER TABLE "checkout_records" ADD COLUMN IF NOT EXISTS "inspectionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "room_inspections_contractId_type_idx" ON "room_inspections"("contractId", "type");
CREATE INDEX IF NOT EXISTS "room_inspections_roomId_idx" ON "room_inspections"("roomId");
CREATE INDEX IF NOT EXISTS "room_inspections_tenantId_idx" ON "room_inspections"("tenantId");
CREATE INDEX IF NOT EXISTS "room_inspections_status_idx" ON "room_inspections"("status");

CREATE INDEX IF NOT EXISTS "inspection_items_inspectionId_idx" ON "inspection_items"("inspectionId");

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_requests_requestNumber_key" ON "checkout_requests"("requestNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_requests_checkoutRecordId_key" ON "checkout_requests"("checkoutRecordId");
CREATE INDEX IF NOT EXISTS "checkout_requests_contractId_idx" ON "checkout_requests"("contractId");
CREATE INDEX IF NOT EXISTS "checkout_requests_tenantId_idx" ON "checkout_requests"("tenantId");
CREATE INDEX IF NOT EXISTS "checkout_requests_status_idx" ON "checkout_requests"("status");
CREATE INDEX IF NOT EXISTS "checkout_requests_expectedCheckoutDate_idx" ON "checkout_requests"("expectedCheckoutDate");

-- AddForeignKey
ALTER TABLE "room_inspections" ADD CONSTRAINT "room_inspections_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_inspections" ADD CONSTRAINT "room_inspections_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_inspections" ADD CONSTRAINT "room_inspections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "room_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_checkoutRecordId_fkey" FOREIGN KEY ("checkoutRecordId") REFERENCES "checkout_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "room_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
