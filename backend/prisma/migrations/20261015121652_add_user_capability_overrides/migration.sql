-- CreateEnum
CREATE TYPE "CapabilityEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "user_capability_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "effect" "CapabilityEffect" NOT NULL,
    "reason" TEXT,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_capability_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_capability_overrides_userId_idx" ON "user_capability_overrides"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_capability_overrides_userId_capability_key" ON "user_capability_overrides"("userId", "capability");

-- AddForeignKey
ALTER TABLE "user_capability_overrides" ADD CONSTRAINT "user_capability_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
