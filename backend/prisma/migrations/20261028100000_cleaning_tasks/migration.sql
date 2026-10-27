-- CreateEnum
CREATE TYPE "CleaningTaskType" AS ENUM ('CHECKOUT', 'DAILY', 'DEEP', 'INSPECTION');

-- CreateEnum
CREATE TYPE "CleaningTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "cleaning_tasks" (
    "id" TEXT NOT NULL,
    "taskNumber" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" "CleaningTaskType" NOT NULL DEFAULT 'CHECKOUT',
    "status" "CleaningTaskStatus" NOT NULL DEFAULT 'PENDING',
    "cleanerId" TEXT,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "rating" INTEGER,
    "acceptanceNotes" TEXT,
    "beforePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "afterPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_tasks_taskNumber_key" ON "cleaning_tasks"("taskNumber");

-- CreateIndex
CREATE INDEX "cleaning_tasks_buildingId_idx" ON "cleaning_tasks"("buildingId");

-- CreateIndex
CREATE INDEX "cleaning_tasks_roomId_idx" ON "cleaning_tasks"("roomId");

-- CreateIndex
CREATE INDEX "cleaning_tasks_cleanerId_idx" ON "cleaning_tasks"("cleanerId");

-- CreateIndex
CREATE INDEX "cleaning_tasks_status_idx" ON "cleaning_tasks"("status");

-- AddForeignKey
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
