-- T302 / WRK-01: 员工角色、权限与楼栋范围

-- AlterEnum UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROPERTY_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FINANCIAL';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MAINTAINER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';

-- CreateTable staff_building_assignments
CREATE TABLE IF NOT EXISTS "staff_building_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_building_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "staff_building_assignments_userId_buildingId_key" ON "staff_building_assignments"("userId", "buildingId");
CREATE INDEX IF NOT EXISTS "staff_building_assignments_userId_idx" ON "staff_building_assignments"("userId");
CREATE INDEX IF NOT EXISTS "staff_building_assignments_buildingId_idx" ON "staff_building_assignments"("buildingId");

-- AddForeignKey
ALTER TABLE "staff_building_assignments" ADD CONSTRAINT "staff_building_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_building_assignments" ADD CONSTRAINT "staff_building_assignments_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
