-- AlterTable
ALTER TABLE "late_fees" ADD COLUMN     "settledAmount" INTEGER,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledBy" TEXT;
