-- T290 / WX-01：微信小程序身份提供方与 unionId

-- AlterEnum
ALTER TYPE "IdentityProvider" ADD VALUE IF NOT EXISTS 'WECHAT_MP';

-- AlterTable
ALTER TABLE "user_identities" ADD COLUMN IF NOT EXISTS "unionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_identities_unionId_idx" ON "user_identities"("unionId");
