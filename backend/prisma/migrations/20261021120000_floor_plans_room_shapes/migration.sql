CREATE TYPE "ShapeKind" AS ENUM ('RECT', 'POLYGON');

CREATE TABLE "floor_plans" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL,
    "backgroundUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_shapes" (
    "id" TEXT NOT NULL,
    "floorPlanId" TEXT NOT NULL,
    "roomId" TEXT,
    "kind" "ShapeKind" NOT NULL DEFAULT 'RECT',
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL,
    "polygon" JSONB,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "room_shapes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "floor_plans_buildingId_floor_key" ON "floor_plans"("buildingId", "floor");
CREATE INDEX "floor_plans_buildingId_idx" ON "floor_plans"("buildingId");
CREATE UNIQUE INDEX "room_shapes_roomId_key" ON "room_shapes"("roomId");
CREATE INDEX "room_shapes_floorPlanId_idx" ON "room_shapes"("floorPlanId");

ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_shapes" ADD CONSTRAINT "room_shapes_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_shapes" ADD CONSTRAINT "room_shapes_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
