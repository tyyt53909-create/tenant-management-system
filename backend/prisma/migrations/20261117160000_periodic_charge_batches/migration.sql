CREATE TABLE IF NOT EXISTS "periodic_charge_batches" (
  "id" TEXT PRIMARY KEY,
  "buildingId" TEXT NOT NULL REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period" TEXT NOT NULL,
  "cutoff" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "confirmedBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "periodic_charge_items" (
  "id" TEXT PRIMARY KEY,
  "batchId" TEXT NOT NULL REFERENCES "periodic_charge_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "review" JSONB NOT NULL,
  "result" JSONB,
  "notificationState" TEXT,
  "notificationUserId" TEXT,
  "notificationId" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "periodic_charge_items_batchId_kind_targetId_key" ON "periodic_charge_items"("batchId","kind","targetId");
CREATE INDEX IF NOT EXISTS "periodic_charge_items_state_id_idx" ON "periodic_charge_items"("state","id");
CREATE INDEX IF NOT EXISTS "periodic_charge_items_notificationState_idx" ON "periodic_charge_items"("notificationState");
