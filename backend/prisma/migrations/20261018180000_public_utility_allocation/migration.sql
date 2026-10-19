-- CreateTable
CREATE TABLE "public_utility_bills" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "meterType" "MeterType" NOT NULL,
    "period" TEXT NOT NULL,
    "meterId" TEXT,
    "openingReading" DECIMAL(10,2),
    "closingReading" DECIMAL(10,2),
    "usage" DECIMAL(10,2),
    "unitPrice" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "billsGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_utility_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_utility_allocations" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "baseAreaHundredths" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_utility_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_utility_bills_period_idx" ON "public_utility_bills"("period");

-- CreateIndex
CREATE UNIQUE INDEX "public_utility_bills_buildingId_meterType_period_key" ON "public_utility_bills"("buildingId", "meterType", "period");

-- CreateIndex
CREATE INDEX "public_utility_allocations_contractId_idx" ON "public_utility_allocations"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "public_utility_allocations_billId_contractId_key" ON "public_utility_allocations"("billId", "contractId");

-- AddForeignKey
ALTER TABLE "public_utility_bills" ADD CONSTRAINT "public_utility_bills_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_utility_bills" ADD CONSTRAINT "public_utility_bills_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_utility_allocations" ADD CONSTRAINT "public_utility_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public_utility_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_utility_allocations" ADD CONSTRAINT "public_utility_allocations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_utility_allocations" ADD CONSTRAINT "public_utility_allocations_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

