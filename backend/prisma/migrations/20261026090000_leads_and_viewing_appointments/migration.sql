-- T298 / LSE-01: 招租挂牌、意向线索与看房预约

-- AlterTable rooms: 添加挂牌租金、上架开关与可用日期
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "listingPrice" INTEGER;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "isListed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "availableDate" DATE;

-- CreateEnum LeadStatus
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'FOLLOWING', 'CONVERTED', 'CLOSED');

-- CreateEnum LeadSource
CREATE TYPE "LeadSource" AS ENUM ('MINIPROGRAM', 'WEB', 'FRIEND_SHARE', 'POSTER', 'OFFLINE', 'OTHER');

-- CreateEnum AppointmentStatus
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateTable leads
CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "roomType" "RoomType",
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "expectedMoveIn" DATE,
    "source" "LeadSource" NOT NULL DEFAULT 'MINIPROGRAM',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "roomId" TEXT,
    "followUpBy" TEXT,
    "lastFollowedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable viewing_appointments
CREATE TABLE IF NOT EXISTS "viewing_appointments" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "appointmentTime" TIMESTAMP(3) NOT NULL,
    "visitorsCount" INTEGER NOT NULL DEFAULT 1,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "feedback" TEXT,
    "cancelledReason" TEXT,
    "userId" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viewing_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_status_createdAt_idx" ON "leads"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "leads_phone_idx" ON "leads"("phone");
CREATE INDEX IF NOT EXISTS "leads_roomId_idx" ON "leads"("roomId");

CREATE INDEX IF NOT EXISTS "viewing_appointments_roomId_appointmentTime_idx" ON "viewing_appointments"("roomId", "appointmentTime");
CREATE INDEX IF NOT EXISTS "viewing_appointments_status_appointmentTime_idx" ON "viewing_appointments"("status", "appointmentTime");
CREATE INDEX IF NOT EXISTS "viewing_appointments_phone_idx" ON "viewing_appointments"("phone");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viewing_appointments" ADD CONSTRAINT "viewing_appointments_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
