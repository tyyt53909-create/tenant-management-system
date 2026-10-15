-- CreateTable
CREATE TABLE "file_assets" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT,
    "uploadedBy" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_key_key" ON "file_assets"("key");

-- CreateIndex
CREATE INDEX "file_assets_uploadedBy_idx" ON "file_assets"("uploadedBy");

-- CreateIndex
CREATE INDEX "file_assets_tenantId_idx" ON "file_assets"("tenantId");
