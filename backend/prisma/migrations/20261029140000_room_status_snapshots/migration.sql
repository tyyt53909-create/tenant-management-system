-- Expand-only: historical rows are never automatically updated or removed.
CREATE TABLE "room_status_snapshots" (
  "id" TEXT NOT NULL,
  "buildingId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "total" INTEGER NOT NULL,
  "vacant" INTEGER NOT NULL,
  "reserved" INTEGER NOT NULL,
  "occupied" INTEGER NOT NULL,
  "maintenance" INTEGER NOT NULL,
  CONSTRAINT "room_status_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_status_snapshots_counts_check" CHECK (
    "vacant" >= 0 AND "reserved" >= 0 AND "occupied" >= 0 AND "maintenance" >= 0
    AND "total" = "vacant" + "reserved" + "occupied" + "maintenance"
  ),
  CONSTRAINT "room_status_snapshots_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "room_status_snapshots_buildingId_businessDate_key" ON "room_status_snapshots"("buildingId", "businessDate");
