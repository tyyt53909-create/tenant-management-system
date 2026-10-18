-- CreateEnum
CREATE TYPE "InviteCodeStatus" AS ENUM ('UNUSED', 'USED', 'REVOKED');

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'TENANT',
    "status" "InviteCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "notes" TEXT,
    "creatorId" TEXT,
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_usedById_key" ON "invite_codes"("usedById");

-- CreateIndex
CREATE INDEX "invite_codes_code_idx" ON "invite_codes"("code");

-- CreateIndex
CREATE INDEX "invite_codes_status_idx" ON "invite_codes"("status");

-- CreateIndex
CREATE INDEX "invite_codes_creatorId_idx" ON "invite_codes"("creatorId");

-- Migrate existing invite codes from users table
INSERT INTO "invite_codes" ("id", "code", "role", "status", "creatorId", "expiresAt", "createdAt", "updatedAt")
SELECT
    'migrated_' || "id",
    "inviteCode",
    'TENANT',
    'UNUSED',
    "id",
    COALESCE("inviteExpiredAt", NOW() + INTERVAL '365 days'),
    NOW(),
    NOW()
FROM "users"
WHERE "inviteCode" IS NOT NULL AND "inviteCode" != ''
ON CONFLICT ("code") DO NOTHING;

-- DropIndex
DROP INDEX IF EXISTS "users_inviteCode_idx";
DROP INDEX IF EXISTS "users_inviteCode_key";

-- AlterTable users
ALTER TABLE "users" DROP COLUMN IF EXISTS "inviteCode",
DROP COLUMN IF EXISTS "inviteExpiredAt";

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
