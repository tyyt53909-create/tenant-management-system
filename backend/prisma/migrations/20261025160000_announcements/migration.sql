-- COM-04 / T284：公告与定向消息。
DO $$ BEGIN
  CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL_TENANTS', 'BUILDING', 'TAGS', 'TENANTS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL_TENANTS',
  "targetIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "publishAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "announcements_status_publishedAt_idx" ON "announcements"("status", "publishedAt");
CREATE INDEX IF NOT EXISTS "announcements_audience_idx" ON "announcements"("audience");

DO $$ BEGIN
  ALTER TABLE "announcements"
    ADD CONSTRAINT "announcements_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
