-- COM-03 / T283：报修工单时间线与双向沟通。
DO $$ BEGIN
  CREATE TYPE "MaintenanceMessageType" AS ENUM ('MESSAGE', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "maintenance_messages" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "type" "MaintenanceMessageType" NOT NULL DEFAULT 'MESSAGE',
  "authorId" TEXT,
  "authorRole" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "maintenance_messages_requestId_createdAt_idx"
  ON "maintenance_messages"("requestId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "maintenance_messages"
    ADD CONSTRAINT "maintenance_messages_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
