-- T301 / LSE-04: 到期提醒、续约意向与续约报价

-- CreateEnum RenewalIntentType
CREATE TYPE "RenewalIntentType" AS ENUM ('RENEW', 'NOT_RENEW', 'CONSIDERING');

-- CreateEnum RenewalOfferStatus
CREATE TYPE "RenewalOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateTable renewal_intents
CREATE TABLE IF NOT EXISTS "renewal_intents" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "intent" "RenewalIntentType" NOT NULL,
    "expectedMonths" INTEGER,
    "expectedRent" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable renewal_offers
CREATE TABLE IF NOT EXISTS "renewal_offers" (
    "id" TEXT NOT NULL,
    "offerNumber" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "offeredRent" INTEGER NOT NULL,
    "offeredDeposit" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "discountNotes" TEXT,
    "validUntil" TIMESTAMP(3),
    "status" "RenewalOfferStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "renewedContractId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewal_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "renewal_intents_contractId_idx" ON "renewal_intents"("contractId");
CREATE INDEX IF NOT EXISTS "renewal_intents_tenantId_idx" ON "renewal_intents"("tenantId");
CREATE INDEX IF NOT EXISTS "renewal_intents_intent_idx" ON "renewal_intents"("intent");

CREATE UNIQUE INDEX IF NOT EXISTS "renewal_offers_offerNumber_key" ON "renewal_offers"("offerNumber");
CREATE INDEX IF NOT EXISTS "renewal_offers_contractId_idx" ON "renewal_offers"("contractId");
CREATE INDEX IF NOT EXISTS "renewal_offers_tenantId_idx" ON "renewal_offers"("tenantId");
CREATE INDEX IF NOT EXISTS "renewal_offers_roomId_idx" ON "renewal_offers"("roomId");
CREATE INDEX IF NOT EXISTS "renewal_offers_status_idx" ON "renewal_offers"("status");

-- AddForeignKey
ALTER TABLE "renewal_intents" ADD CONSTRAINT "renewal_intents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "renewal_intents" ADD CONSTRAINT "renewal_intents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "renewal_offers" ADD CONSTRAINT "renewal_offers_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "renewal_offers" ADD CONSTRAINT "renewal_offers_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "renewal_offers" ADD CONSTRAINT "renewal_offers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
