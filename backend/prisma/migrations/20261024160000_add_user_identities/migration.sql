-- SEC-04：外部身份表（expand）。仅新增枚举、可空列与新表，并回填既有 Google 身份。
-- 保留 users.googleId 作为兼容列，contract 阶段另立任务删除。

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'EMAIL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_providerUserId_key" ON "user_identities"("provider", "providerUserId");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill：把既有 users.googleId 写成 GOOGLE 身份（邮箱视为已验证）
INSERT INTO "user_identities" ("id", "userId", "provider", "providerUserId", "email", "emailVerifiedAt", "createdAt", "lastUsedAt")
SELECT
    'ident_' || md5("id" || clock_timestamp()::text),
    "id",
    'GOOGLE',
    "googleId",
    "email",
    COALESCE("lastLoginAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP,
    "lastLoginAt"
FROM "users"
WHERE "googleId" IS NOT NULL;

UPDATE "users"
SET "emailVerifiedAt" = COALESCE("lastLoginAt", CURRENT_TIMESTAMP)
WHERE "googleId" IS NOT NULL AND "emailVerifiedAt" IS NULL;
