-- SEC-07：文件附件模型（expand）。新增用途/可见性/归属字段，并回填房源照片为公开。
-- 保留 RoomPhoto.fileUrl 冗余列；公开地址在响应层改写，contract 阶段再统一。

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('ROOM_PHOTO', 'CONTRACT', 'MAINTENANCE', 'AVATAR', 'RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "file_assets"
  ADD COLUMN "thumbnailKey" TEXT,
  ADD COLUMN "purpose" "FilePurpose" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "ownerType" TEXT,
  ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "file_assets_visibility_idx" ON "file_assets"("visibility");

-- CreateIndex
CREATE INDEX "file_assets_ownerType_ownerId_idx" ON "file_assets"("ownerType", "ownerId");

-- Backfill：被房源照片引用的对象键置为公开、用途 ROOM_PHOTO、归属对应房间
UPDATE "file_assets" AS fa
SET
  "purpose" = 'ROOM_PHOTO',
  "visibility" = 'PUBLIC',
  "ownerType" = 'ROOM',
  "ownerId" = rp."roomId"
FROM "room_photos" AS rp
WHERE fa."key" = regexp_replace(rp."fileUrl", '^/api/(public/)?files/', '')
   OR fa."key" = regexp_replace(COALESCE(rp."thumbnail", ''), '^/api/(public/)?files/', '');
