-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'ONE_BED', 'TWO_BED', 'THREE_BED', 'STUDIO');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('VACANT', 'RESERVED', 'OCCUPIED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "CleanStatus" AS ENUM ('CLEAN', 'PENDING_CLEAN', 'CLEANING');

-- CreateEnum
CREATE TYPE "PublicAreaType" AS ENUM ('HALLWAY', 'STAIRWELL', 'ELEVATOR', 'ROOF', 'ENTRANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('ID_CARD', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('CONTRACT_SCAN', 'ID_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "BillType" AS ENUM ('RENT', 'UTILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'WECHAT', 'ALIPAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PrepayTransactionType" AS ENUM ('RECHARGE', 'DEDUCTION', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RelatedType" AS ENUM ('METER_READING', 'CHECKOUT', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('ELECTRICITY', 'WATER', 'GAS');

-- CreateEnum
CREATE TYPE "ReadingSource" AS ENUM ('MANUAL', 'DEVICE');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'APPLIANCE', 'FURNITURE', 'DOOR_WINDOW', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('DRAFT', 'PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckoutItemType" AS ENUM ('RENT_REFUND', 'DEPOSIT_REFUND', 'DEPOSIT_DEDUCTION', 'UTILITY_REFUND', 'OTHER_FEE', 'OTHER_REFUND');

-- CreateEnum
CREATE TYPE "RentCalculationMethod" AS ENUM ('ACTUAL_DAYS', 'FIXED_30_DAYS');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CLEANER', 'TENANT');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "floors" INTEGER NOT NULL,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "area" DECIMAL(6,2),
    "facilities" JSONB,
    "description" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'VACANT',
    "cleanStatus" "CleanStatus" NOT NULL DEFAULT 'CLEAN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_areas" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaType" "PublicAreaType" NOT NULL,
    "floor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "tags" JSONB,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "inviteCode" TEXT,
    "inviteExpiredAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "rentAmount" INTEGER NOT NULL,
    "depositAmount" INTEGER NOT NULL,
    "paymentCycle" "PaymentCycle" NOT NULL,
    "paymentDay" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "lateFeeRule" JSONB NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "renewedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_attachments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "billType" "BillType" NOT NULL,
    "period" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "transactionNumber" TEXT,
    "paidAt" TIMESTAMP NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fees" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "suggestedAmount" INTEGER NOT NULL,
    "confirmedAmount" INTEGER,
    "overdueDays" INTEGER NOT NULL,
    "calculation" JSONB NOT NULL,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepay_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "balanceCache" INTEGER NOT NULL DEFAULT 0,
    "lowBalanceThreshold" INTEGER NOT NULL DEFAULT 10000,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prepay_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepay_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "PrepayTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "relatedId" TEXT,
    "relatedType" "RelatedType",
    "description" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepay_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meters" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "roomId" TEXT,
    "publicAreaId" TEXT,
    "meterType" "MeterType" NOT NULL,
    "meterNumber" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "priceEffectiveDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "currentReading" DECIMAL(10,2) NOT NULL,
    "previousReading" DECIMAL(10,2) NOT NULL,
    "usage" DECIMAL(10,2) NOT NULL,
    "source" "ReadingSource" NOT NULL,
    "readingTime" TIMESTAMP(3) NOT NULL,
    "readBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_photos" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnail" TEXT,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_records" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "checkoutDate" DATE NOT NULL,
    "totalRefund" INTEGER NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "processedBy" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_items" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "itemType" "CheckoutItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "calculation" JSONB,
    "isAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "adjustReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_registrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idType" "IdType" NOT NULL,
    "idNumber" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'NOT_REGISTERED',
    "registeredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_photos" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnail" TEXT,
    "fileSize" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_price_history" (
    "id" TEXT NOT NULL,
    "meterType" "MeterType" NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buildings_isActive_idx" ON "buildings"("isActive");

-- CreateIndex
CREATE INDEX "rooms_buildingId_status_idx" ON "rooms"("buildingId", "status");

-- CreateIndex
CREATE INDEX "rooms_status_cleanStatus_idx" ON "rooms"("status", "cleanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_buildingId_floor_roomNumber_key" ON "rooms"("buildingId", "floor", "roomNumber");

-- CreateIndex
CREATE INDEX "public_areas_buildingId_idx" ON "public_areas"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_phone_key" ON "tenants"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_email_key" ON "tenants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_userId_key" ON "tenants"("userId");

-- CreateIndex
CREATE INDEX "tenants_isActive_idx" ON "tenants"("isActive");

-- CreateIndex
CREATE INDEX "tenants_phone_idx" ON "tenants"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteCode_key" ON "users"("inviteCode");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_inviteCode_idx" ON "users"("inviteCode");

-- CreateIndex
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contractNumber_key" ON "contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_renewedFromId_key" ON "contracts"("renewedFromId");

-- CreateIndex
CREATE INDEX "contracts_buildingId_status_idx" ON "contracts"("buildingId", "status");

-- CreateIndex
CREATE INDEX "contracts_tenantId_status_idx" ON "contracts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contracts_roomId_status_idx" ON "contracts"("roomId", "status");

-- CreateIndex
CREATE INDEX "contracts_status_endDate_idx" ON "contracts"("status", "endDate");

-- CreateIndex
CREATE INDEX "contract_attachments_contractId_idx" ON "contract_attachments"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_billNumber_key" ON "bills"("billNumber");

-- CreateIndex
CREATE INDEX "bills_contractId_status_idx" ON "bills"("contractId", "status");

-- CreateIndex
CREATE INDEX "bills_status_dueDate_idx" ON "bills"("status", "dueDate");

-- CreateIndex
CREATE INDEX "payment_records_billId_idx" ON "payment_records"("billId");

-- CreateIndex
CREATE INDEX "payment_records_paidAt_idx" ON "payment_records"("paidAt");

-- CreateIndex
CREATE INDEX "late_fees_billId_idx" ON "late_fees"("billId");

-- CreateIndex
CREATE INDEX "prepay_accounts_tenantId_idx" ON "prepay_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "prepay_accounts_balanceCache_idx" ON "prepay_accounts"("balanceCache");

-- CreateIndex
CREATE UNIQUE INDEX "prepay_accounts_tenantId_roomId_key" ON "prepay_accounts"("tenantId", "roomId");

-- CreateIndex
CREATE INDEX "prepay_transactions_accountId_createdAt_idx" ON "prepay_transactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "prepay_transactions_relatedId_relatedType_idx" ON "prepay_transactions"("relatedId", "relatedType");

-- CreateIndex
CREATE INDEX "meters_buildingId_meterType_idx" ON "meters"("buildingId", "meterType");

-- CreateIndex
CREATE INDEX "meters_roomId_idx" ON "meters"("roomId");

-- CreateIndex
CREATE INDEX "meters_publicAreaId_idx" ON "meters"("publicAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "meters_meterNumber_key" ON "meters"("meterNumber");

-- CreateIndex
CREATE INDEX "meter_readings_meterId_readingTime_idx" ON "meter_readings"("meterId", "readingTime");

-- CreateIndex
CREATE INDEX "maintenance_requests_roomId_status_idx" ON "maintenance_requests"("roomId", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_tenantId_status_idx" ON "maintenance_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_createdAt_idx" ON "maintenance_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "maintenance_photos_requestId_idx" ON "maintenance_photos"("requestId");

-- CreateIndex
CREATE INDEX "checkout_records_contractId_idx" ON "checkout_records"("contractId");

-- CreateIndex
CREATE INDEX "checkout_records_status_idx" ON "checkout_records"("status");

-- CreateIndex
CREATE INDEX "checkout_items_checkoutId_idx" ON "checkout_items"("checkoutId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_registrations_tenantId_key" ON "tenant_registrations"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_registrations_tenantId_idx" ON "tenant_registrations"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_registrations_status_idx" ON "tenant_registrations"("status");

-- CreateIndex
CREATE INDEX "device_tokens_userId_isActive_idx" ON "device_tokens"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_userId_deviceId_key" ON "device_tokens"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "room_photos_roomId_sortOrder_idx" ON "room_photos"("roomId", "sortOrder");

-- CreateIndex
CREATE INDEX "meter_price_history_meterType_effectiveDate_idx" ON "meter_price_history"("meterType", "effectiveDate");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_areas" ADD CONSTRAINT "public_areas_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contract_attachments" ADD CONSTRAINT "contract_attachments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fees" ADD CONSTRAINT "late_fees_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepay_accounts" ADD CONSTRAINT "prepay_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepay_transactions" ADD CONSTRAINT "prepay_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "prepay_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_publicAreaId_fkey" FOREIGN KEY ("publicAreaId") REFERENCES "public_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_photos" ADD CONSTRAINT "maintenance_photos_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_records" ADD CONSTRAINT "checkout_records_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_items" ADD CONSTRAINT "checkout_items_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "checkout_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_registrations" ADD CONSTRAINT "tenant_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_photos" ADD CONSTRAINT "room_photos_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
